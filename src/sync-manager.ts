/**
 * Sync orchestrator for Calendar Bridge.
 *
 * Implements an idempotent sync loop:
 *   1. Fetch ICS data from every enabled CalendarSource
 *   2. Parse events that start within [today, today + horizonDays]
 *   3. For each event:
 *        • If the meeting note doesn't exist → create it from the template
 *        • If it does exist → update only the AUTOGEN blocks, leaving manual
 *          edits untouched
 *   4. For every recurring series discovered → maintain a series index page
 *      (same idempotent create-or-update semantics)
 */

import { App, TFile, requestUrl } from 'obsidian';
import { NormalizedEvent, PluginSettings } from './types';
import { parseAndFilterEvents } from './ics-parser';
import {
	DEFAULT_TEMPLATE,
	AUTOGEN_AGENDA_START,
	fillTemplateNormalized,
	getNotePath,
	updateAutogenBlocks,
	updateAutogenBlocksNamed,
	buildAgendaBlock,
	buildJoinersBlock,
	buildLinksBlock,
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
	/** All NormalizedEvents processed in this sync (populated by runSync). */
	normalizedEvents?: import('./types').NormalizedEvent[];
}

/** Signature of the HTTP fetch function (injectable for tests). */
export type FetchFn = (url: string) => Promise<string>;

/**
 * Flexible settings type that accepts both new PluginSettings fields
 * and the legacy test-fixture fields (calendarSources, notesFolder, etc.)
 */
export type SyncSettings = PluginSettings & {
	// Legacy test fields
	calendarSources?: Array<{ id: string; name: string; url: string; enabled: boolean }>;
	notesFolder?: string;
	seriesFolder?: string;
	syncHorizonDays?: number;
};

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
	settings: SyncSettings,
	fetchFn: FetchFn = defaultFetch,
	now: Date = new Date(),
): Promise<SyncResult> {
	const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };

	// ── Resolve settings with legacy fallbacks ───────────────────────────
	const horizonDays  = settings.syncHorizonDays ?? settings.horizonDays ?? 3;
	const notesFolder  = settings.notesFolder ?? settings.meetingsRoot ?? 'Meetings';
	const seriesFolder = settings.seriesFolder ?? settings.seriesRoot ?? 'Meetings/_series';

	// Unified source list: support both new `sources` and legacy `calendarSources`
	const legacySources = settings.calendarSources ?? [];
	const newSources    = settings.sources ?? [];

	// Merge: legacy sources win if both present (tests use legacy)
	const allSources = legacySources.length > 0
		? legacySources.map(s => ({ ...s, sourceType: 'ics_public' as const, ics: { url: s.url, pollIntervalMinutes: 60 } }))
		: newSources;

	// ── Compute date range ──────────────────────────────────────────────────
	const from = new Date(now);
	from.setHours(0, 0, 0, 0);
	const to = new Date(from);
	to.setDate(to.getDate() + horizonDays);

	// ── Fetch & parse all sources ───────────────────────────────────────────
	const allEvents: NormalizedEvent[] = [];

	for (const source of allSources) {
		if (!source.enabled) continue;
		const url = (source as { url?: string }).url
			?? source.ics?.url
			?? '';
		if (!url) continue;

		try {
			const icsData = await fetchFn(url);
			const parsed  = parseAndFilterEvents(icsData, from, to);
			for (const e of parsed) {
				const normalized: NormalizedEvent = {
					source:      'ics_public',
					calendarId:  source.id,
					eventId:     e.uid,
					uid:         e.uid,
					title:       e.title,
					start:       e.startDate.toISOString(),
					end:         e.endDate.toISOString(),
					startDate:   e.startDate,
					endDate:     e.endDate,
					isAllDay:    e.isAllDay,
					status:      'confirmed',
					seriesKey:   e.isRecurring ? `ical:${e.uid}` : `single:${e.uid}`,
					isRecurring: e.isRecurring,
					sourceName:  source.name,
					description: e.description || undefined,
					location:    e.location    || undefined,
					attendees:   e.attendees,
					organizer:   e.organizerName
						? `${e.organizerName} <${e.organizerEmail}>`
						: e.organizerEmail,
				};
				allEvents.push(normalized);
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
	await ensureFolderExists(app, notesFolder);

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
	// groupBySeries still takes CalendarEvent — use a shim
	const legacyEvents = allEvents.map(e => ({
		uid:         e.uid,
		title:       e.title,
		description: e.description ?? '',
		location:    e.location    ?? '',
		startDate:   e.startDate,
		endDate:     e.endDate,
		isAllDay:    e.isAllDay,
		isRecurring: e.isRecurring,
		attendees:   e.attendees ?? [],
		organizer:   e.organizer,
		sourceId:    e.calendarId,
		sourceName:  e.sourceName,
	}));

	const seriesMap = groupBySeries(legacyEvents);

	if (seriesMap.size > 0) {
		await ensureFolderExists(app, seriesFolder);
	}

	// Pre-compute series page paths for meeting note cross-links
	const seriesLinks = new Map<string, string>(); // uid → wikilink
	for (const [, series] of seriesMap) {
		const seriesPath = getSeriesPath(series.title, { ...settings, seriesFolder });
		const seriesName = seriesPath.split('/').pop()?.replace(/\.md$/, '') ?? series.title;
		seriesLinks.set(series.uid, `[[${seriesName}]]`);
	}

	// Effective settings for path generation
	// When legacy calendarSources are in use, clear meetingsRoot so getNotePath
	// uses the flat legacy path: {notesFolder}/{date} {title}.md
	const usingLegacySources = legacySources.length > 0;
	const pathSettings = {
		...settings,
		notesFolder,
		seriesFolder,
		meetingsRoot: usingLegacySources ? undefined : (settings.meetingsRoot ?? notesFolder),
	};

	// ── Create / update meeting notes ───────────────────────────────────────
	for (const event of allEvents) {
		const notePath      = getNotePath(event, pathSettings);
		const seriesPagePath = event.isRecurring
			? (() => {
				const sp = getSeriesPath(event.title, { ...settings, seriesFolder });
				return sp.split('/').pop()?.replace(/\.md$/, '') ?? event.title;
			})()
			: undefined;

		// Build note content using the new normalized renderer
		const newContent = fillTemplateNormalized(template, {
			event,
			settings: { ...settings, meetingsRoot: notesFolder, seriesRoot: seriesFolder } as PluginSettings,
			seriesPagePath,
		});

		try {
			const existing = app.vault.getAbstractFileByPath(notePath);
			if (existing instanceof TFile) {
				const existingContent = await app.vault.read(existing);

				// Support both old single-block AUTOGEN and new named blocks
				const hasNamedBlocks = existingContent.includes(AUTOGEN_AGENDA_START);
				let updated: string;

				if (hasNamedBlocks) {
					const agendaBody  = buildAgendaBlock(event);
					const joinersBody = buildJoinersBlock(event, settings as PluginSettings);
					const linksBody   = buildLinksBlock({ event, seriesPagePath });
					updated = updateAutogenBlocksNamed(existingContent, {
						agendaBody,
						joinersBody,
						linksBody,
					});
				} else {
					updated = updateAutogenBlocks(existingContent, newContent);
				}

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
		const seriesPath = getSeriesPath(series.title, { ...settings, seriesFolder });
		const notePathFn = (e: typeof legacyEvents[0]) => getNotePath(e, pathSettings);

		try {
			const existing = app.vault.getAbstractFileByPath(seriesPath);
			if (existing instanceof TFile) {
				const existingContent = await app.vault.read(existing);
				const autogenBody     = generateSeriesAutogen(series, notePathFn, now);
				const newBlock        = wrapAutogen(autogenBody);
				const updated         = updateAutogenBlocks(existingContent, newBlock);
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

	result.normalizedEvents = allEvents;
	return result;
}
