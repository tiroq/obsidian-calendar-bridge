/**
 * Sync orchestrator for Calendar Bridge.
 *
 * Implements an idempotent sync loop:
 *   1. Fetch ICS data from every enabled CalendarSource
 *   2. Parse events that start within [today, today + syncHorizonDays]
 *   3. For each event:
 *        • If the meeting note doesn't exist → create it from the template
 *        • If it does exist → update only the AUTOGEN block, leaving manual
 *          edits untouched
 *   4. For every recurring series discovered → maintain a series index page
 *      (same idempotent create-or-update semantics)
 */

import { App, TFile, requestUrl } from 'obsidian';
import { CalendarEvent, PluginSettings } from './types';
import { parseAndFilterEvents } from './ics-parser';
import {
	DEFAULT_TEMPLATE,
	fillTemplate,
	getNotePath,
	updateAutogenBlocks,
} from './note-generator';
import {
	generateSeriesAutogen,
	generateSeriesPageContent,
	getSeriesPath,
	groupBySeries,
	wrapAutogen,
} from './series-manager';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncResult {
	created: number;
	updated: number;
	skipped: number;
	errors: string[];
}

/** Signature of the HTTP fetch function (injectable for tests). */
export type FetchFn = (url: string) => Promise<string>;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Default fetch implementation that uses Obsidian's `requestUrl` helper
 * (works on both desktop and mobile, bypasses CORS restrictions).
 */
async function defaultFetch(url: string): Promise<string> {
	const response = await requestUrl({ url, method: 'GET' });
	return response.text;
}

/**
 * Ensure that every segment of a slash-separated path exists as a folder,
 * creating missing segments from left to right.
 */
async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
	const parts = folderPath.split('/').filter(Boolean);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			try {
				await app.vault.createFolder(current);
			} catch {
				// Folder was likely created by a concurrent call — ignore.
			}
		}
	}
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a full idempotent calendar sync.
 *
 * @param app       Obsidian App instance
 * @param settings  Current plugin settings
 * @param fetchFn   Inject a custom fetch function (used in tests)
 * @param now       Reference "current time" (used in tests)
 */
export async function runSync(
	app: App,
	settings: PluginSettings,
	fetchFn: FetchFn = defaultFetch,
	now: Date = new Date(),
): Promise<SyncResult> {
	const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };

	// ── Compute date range ──────────────────────────────────────────────────
	const from = new Date(now);
	from.setHours(0, 0, 0, 0);
	const to = new Date(from);
	to.setDate(to.getDate() + settings.syncHorizonDays);

	// ── Fetch & parse all sources ───────────────────────────────────────────
	const allEvents: CalendarEvent[] = [];

	for (const source of settings.calendarSources) {
		if (!source.enabled) continue;
		try {
			const icsData = await fetchFn(source.url);
			const parsed = parseAndFilterEvents(icsData, from, to);
			for (const e of parsed) {
				allEvents.push({
					...e,
					organizer: e.organizerName
						? `${e.organizerName} <${e.organizerEmail}>`
						: e.organizerEmail,
					sourceId: source.id,
					sourceName: source.name,
				});
			}
		} catch (err) {
			result.errors.push(
				`Failed to fetch "${source.name}": ${(err as Error).message}`,
			);
		}
	}

	if (allEvents.length === 0 && result.errors.length === 0) {
		return result;
	}

	// ── Ensure base notes folder exists ────────────────────────────────────
	await ensureFolderExists(app, settings.notesFolder);

	// ── Load custom template if configured ─────────────────────────────────
	let template = DEFAULT_TEMPLATE;
	if (settings.templatePath) {
		const tplFile = app.vault.getAbstractFileByPath(settings.templatePath);
		if (tplFile instanceof TFile) {
			try {
				template = await app.vault.read(tplFile);
			} catch {
				// Fall back to the built-in template.
			}
		}
	}

	// ── Build series map ────────────────────────────────────────────────────
	const seriesMap = groupBySeries(allEvents);

	if (seriesMap.size > 0) {
		await ensureFolderExists(app, settings.seriesFolder);
	}

	// Pre-compute series wikilinks so meeting notes can reference them
	const seriesLinks = new Map<string, string>(); // uid → wikilink
	for (const [, series] of seriesMap) {
		const seriesPath = getSeriesPath(series.title, settings);
		const seriesName = seriesPath.split('/').pop()?.replace(/\.md$/, '') ?? series.title;
		seriesLinks.set(series.uid, `[[${seriesName}]]`);
	}

	// ── Create / update meeting notes ───────────────────────────────────────
	for (const event of allEvents) {
		const notePath = getNotePath(event, settings);
		const seriesLink = event.isRecurring ? seriesLinks.get(event.uid) : undefined;
		const newContent = fillTemplate(template, event, settings, seriesLink);

		try {
			const existing = app.vault.getAbstractFileByPath(notePath);
			if (existing instanceof TFile) {
				const existingContent = await app.vault.read(existing);
				const updated = updateAutogenBlocks(existingContent, newContent);
				if (updated !== existingContent) {
					await app.vault.modify(existing, updated);
					result.updated++;
				} else {
					result.skipped++;
				}
			} else {
				await app.vault.create(notePath, newContent);
				result.created++;
			}
		} catch (err) {
			result.errors.push(
				`Failed to sync "${event.title}" (${event.startDate.toISOString()}): ${(err as Error).message}`,
			);
		}
	}

	// ── Create / update series index pages ─────────────────────────────────
	for (const [, series] of seriesMap) {
		const seriesPath = getSeriesPath(series.title, settings);
		const notePathFn = (e: CalendarEvent) => getNotePath(e, settings);

		try {
			const existing = app.vault.getAbstractFileByPath(seriesPath);
			if (existing instanceof TFile) {
				const existingContent = await app.vault.read(existing);
				const autogenBody = generateSeriesAutogen(series, notePathFn, now);
				const newBlock = wrapAutogen(autogenBody);
				const updated = updateAutogenBlocks(existingContent, newBlock);
				if (updated !== existingContent) {
					await app.vault.modify(existing, updated);
					result.updated++;
				} else {
					result.skipped++;
				}
			} else {
				const content = generateSeriesPageContent(series, notePathFn, now);
				await app.vault.create(seriesPath, content);
				result.created++;
			}
		} catch (err) {
			result.errors.push(
				`Failed to sync series "${series.title}": ${(err as Error).message}`,
			);
		}
	}

	return result;
}
