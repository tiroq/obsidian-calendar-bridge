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
import { injectBlocks } from './services/TemplateService';
import { resolveTemplatePath } from './services/TemplateRoutingService';
import { NormalizedEvent, PluginSettings, SyncStage } from './types';
import { parseAndFilterEvents } from './ics-parser';
import { GoogleCalendarAdapter } from './sources/gcal-source';
import {
	DEFAULT_TEMPLATE,
	AUTOGEN_AGENDA_START,
	AUTOGEN_JOINERS_START,
	AUTOGEN_JOINERS_END,
	fillTemplateNormalized,
	getNotePath,
	getNotePaths,
	updateAutogenBlocks,
	updateAutogenBlocksNamed,
	buildAgendaBlock,
	buildJoinersBlock,
	buildLinksBlock,
	extractExistingAttendees,
} from './note-generator';
import { buildContactMap } from './contacts';
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
	/** All NormalizedEvents fetched (before any filtering). */
	normalizedEvents?: import('./types').NormalizedEvent[];
	/**
	 * Events whose seriesKey was not yet in the subscription profiles.
	 * Populated only when isSeriesEnabled is provided.
	 */
	newCandidates?: import('./types').NormalizedEvent[];
	// ── Diagnostic counters (always populated) ──────────────────────
	/** Total events fetched from all sources before any filtering. */
	eventsFetched: number;
	/** Events remaining after calendar-ID and series filters. */
	eventsEligible: number;
	/** Notes that were planned for creation/update (eligible events). */
	notesPlanned: number;
	/** Reason string when 0 eligible events (human-readable). */
	zeroReason?: string;
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
	onProgress?: (stage: SyncStage, pct: number) => void,
	/**
	 * Optional per-series enablement check. When provided:
	 *  - events whose seriesKey returns true are synced normally
	 *  - events with unknown seriesKeys are collected in result.newCandidates
	 *  - events whose seriesKey returns false are skipped
	 * When omitted, all events are synced (legacy / preview mode).
	 * The second argument `isRecurring` lets the callback skip gating for one-off events.
	 */
	isSeriesEnabled?: (seriesKey: string, isRecurring: boolean) => boolean | undefined,
	/** When provided, only events from these calendar IDs are synced. */
	selectedCalendarIds?: string[],
	/** When provided, looks up the series profile for a given seriesKey (for template routing). */
	getSeriesProfile?: (seriesKey: string) => import('./types').SeriesProfile | undefined,
): Promise<SyncResult> {
	const result: SyncResult = {
		created: 0, updated: 0, skipped: 0, errors: [],
		newCandidates: [],
		eventsFetched: 0, eventsEligible: 0, notesPlanned: 0,
	};
	const _logSources = (settings.calendarSources ?? []).length > 0 ? settings.calendarSources! : (settings.sources ?? []);
	console.log(`[CalendarBridge] SYNC_START`);
	console.log(`[CalendarBridge] SYNC_CONFIG — horizonDays=${settings.syncHorizonDays ?? settings.horizonDays ?? 3} from=${new Date(now).toISOString().slice(0,10)} enabledSources=${_logSources.filter(s => s.enabled).length}`);
	console.log(`[CalendarBridge] SYNC_PATHS — notesFolder="${settings.notesFolder ?? settings.meetingsRoot ?? 'Meetings'}" seriesFolder="${settings.seriesFolder ?? settings.seriesRoot ?? 'Meetings/_series'}" templatePath="${settings.templatePath || '(built-in)'}"`);
	console.log(`[CalendarBridge] SYNC_FLAGS — usingLegacySources=${(settings.calendarSources ?? []).length > 0} selectedCalendarIds=${selectedCalendarIds ? JSON.stringify(selectedCalendarIds) : 'none'} isSeriesEnabled=${!!isSeriesEnabled}`);
	onProgress?.('authenticating', 5);

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

	onProgress?.('fetching-events', 15);
	for (const source of allSources) {
		if (!source.enabled) { console.log(`[CalendarBridge] SOURCE_SKIP — id=${source.id} name="${source.name}" (disabled)`); continue; }
		const url = (source as { url?: string }).url
			?? source.ics?.url
			?? '';
		if (!url) { console.log(`[CalendarBridge] SOURCE_SKIP — id=${source.id} name="${source.name}" (no URL)`); continue; }

		try {
			console.log(`[CalendarBridge] SOURCE_FETCH — id=${source.id} name="${source.name}" type=ics_public`);
			const icsData = await fetchFn(url);
			const parsed  = parseAndFilterEvents(icsData, from, to);
			console.log(`[CalendarBridge] SOURCE_PARSED — id=${source.id} name="${source.name}" raw=${parsed.length} events in window [${from.toISOString()} → ${to.toISOString()}]`);
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

	// ── Fetch Google Calendar events ──────────────────────────────────────
	for (const source of allSources) {
		if (!source.enabled) { console.log(`[CalendarBridge] GCAL_SKIP — id=${source.id} name="${source.name}" (disabled)`); continue; }
		if (source.sourceType !== 'gcal_api') continue;
		const gcalSettings = (source as { google?: import('./types').GoogleApiSettings }).google;
		if (!gcalSettings) continue;

		const adapter = new GoogleCalendarAdapter({
			id: source.id,
			name: source.name,
			settings: gcalSettings,
			onSettingsUpdate: async (updated) => { Object.assign(gcalSettings, updated); },
		});

		// Use selectedCalendarIds from the source itself, or the param, falling back to ['primary']
		const calIds =
			(selectedCalendarIds && selectedCalendarIds.length > 0)
				? selectedCalendarIds
				: (gcalSettings.selectedCalendarIds ?? []);
		const targets = calIds.length > 0 ? calIds : ['primary'];

		for (const calId of targets) {
			try {
				console.log(`[CalendarBridge] GCAL_FETCH — source="${source.name}" calId=${calId}`);
				const events = await adapter.listEvents(calId, from, to);
				console.log(`[CalendarBridge] GCAL_FETCHED — source="${source.name}" calId=${calId} events=${events.length}`);
				allEvents.push(...events);
			} catch (err) {
				result.errors.push(
					`Failed to fetch gcal "${source.name}" (${calId}): ${(err as Error).message}`,
				);
			}
		}
	}

	// ── Fetch complete ──────────────────────────────────────────────────────
	result.eventsFetched = allEvents.length;
	console.log(`[CalendarBridge] FETCH_EVENTS_DONE — fetched ${allEvents.length} event(s)`);

	// ── Filter by selected calendar IDs (gcal only) ─────────────────────────
	// ── Filter by selected calendar IDs (gcal only) ─────────────────────────
	const gcalCalendarFilter = selectedCalendarIds && selectedCalendarIds.length > 0
		? new Set(selectedCalendarIds)
		: null;

	// ── Filter by series subscription ───────────────────────────────────────
	const filteredEvents: NormalizedEvent[] = [];
	for (const event of allEvents) {
		// Skip gcal events whose calendar was not selected
		if (gcalCalendarFilter && event.source === 'gcal_api' && !gcalCalendarFilter.has(event.calendarId)) {
			console.log(`[CalendarBridge] EVENT_GATE — "${event.title}" calendarId=${event.calendarId} → SKIP (not in gcalCalendarFilter)`);
			result.skipped++;
			continue;
		}
		// Apply per-series filter when provided
		// Apply per-series filter when provided — only for recurring events.
		// Single (non-recurring) events have no series to subscribe to and always sync.
		if (isSeriesEnabled && event.seriesKey && event.isRecurring) {
			const enabled = isSeriesEnabled(event.seriesKey, event.isRecurring);
			console.log(`[CalendarBridge] EVENT_GATE — "${event.title}" seriesKey=${event.seriesKey} recurring=true enabled=${enabled} → ${enabled === undefined ? 'CANDIDATE (new series)' : enabled ? 'SYNC' : 'SKIP (disabled series)'}`);
			if (enabled === undefined) {
				// Unknown series — add to newCandidates but skip sync
				result.newCandidates!.push(event);
				result.skipped++;
				continue;
			}
			if (!enabled) {
				result.skipped++;
				continue;
			}
		}
		filteredEvents.push(event);
		if (isSeriesEnabled && !event.isRecurring) {
			console.log(`[CalendarBridge] EVENT_GATE — "${event.title}" recurring=false → SYNC (non-recurring bypass)`);
		} else if (!isSeriesEnabled) {
			console.log(`[CalendarBridge] EVENT_GATE — "${event.title}" → SYNC (no series gating)`);
		}
	}

	result.eventsEligible = filteredEvents.length;
	result.notesPlanned  = filteredEvents.length;
	console.log(`[CalendarBridge] PLAN_NOTES_DONE — eligible ${filteredEvents.length}/${allEvents.length} event(s)`);

	if (filteredEvents.length === 0) {
		// Compute a human-readable reason for the empty plan
		if (result.errors.length > 0) {
			result.zeroReason = `Fetch errors: ${result.errors[0]}`;
		} else if (allEvents.length === 0) {
			result.zeroReason = 'No eligible events in sync window';
		} else if (isSeriesEnabled && (result.newCandidates?.length ?? 0) === allEvents.length) {
			result.zeroReason = 'All recurring events are unsubscribed — enable series in the Series panel';
		} else if (isSeriesEnabled) {
			result.zeroReason = 'Series selection excluded all events';
		} else {
			result.zeroReason = 'All events filtered out';
		}
		console.log(`[CalendarBridge] WRITE_FILES_DONE — 0 files written. Reason: ${result.zeroReason}`);
		result.normalizedEvents = allEvents;
		return result;
	}

	// ── Ensure base notes folder exists ────────────────────────────────────
	await ensureFolderExists(app, notesFolder);

	// ── Template cache + resolver ──────────────────────────────────────────
	// Templates are loaded lazily and cached by path to avoid redundant vault reads.
	const templateCache = new Map<string, string>(); // '' key = built-in DEFAULT_TEMPLATE
	const loadTemplate = async (path: string): Promise<string> => {
		if (!path) return DEFAULT_TEMPLATE;
		if (templateCache.has(path)) return templateCache.get(path)!;
		const tplFile = app.vault.getAbstractFileByPath(path);
		if (tplFile instanceof TFile) {
			try {
				const content = await app.vault.read(tplFile);
				templateCache.set(path, content);
				return content;
			} catch (err) {
				const msg = `Template read failed (${path}): ${(err as Error).message}. Using built-in template.`;
				console.warn('[CalendarBridge] TEMPLATE_WARN —', msg);
				result.errors.push(msg);
			}
		} else {
			const msg = `Template file not found: "${path}". Using built-in template.`;
			console.warn('[CalendarBridge] TEMPLATE_WARN —', msg);
			result.errors.push(msg);
		}
		return DEFAULT_TEMPLATE;
	};

	// ── Build contact map ───────────────────────────────────────────────────
	const contactMap = settings.contactsFolder
		? await buildContactMap(app, settings.contactsFolder)
		: new Map<string, string>();
	console.log(`[CalendarBridge] CONTACTS — contactsFolder="${settings.contactsFolder || '(disabled)'}" entries=${contactMap.size}`);

	// ── Build series map ────────────────────────────────────────────────────
	// groupBySeries still takes CalendarEvent — use a shim
	const legacyEvents = filteredEvents.map(e => ({
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
	console.log(`[CalendarBridge] PATH_SETTINGS — usingLegacySources=${usingLegacySources} meetingsRoot="${pathSettings.meetingsRoot ?? '(none)'}" notesFolder="${notesFolder}" seriesFolder="${seriesFolder}"`);

	onProgress?.('applying-filters', 50);
	// ── Create / update meeting notes ───────────────────────────────────────
	onProgress?.('writing-notes', 75);
	// Pre-compute note paths for all events, detecting filename conflicts.
	// Conflicting events (same base path) get a short event ID suffix appended.
	const notePathMap = getNotePaths(filteredEvents, pathSettings);
	for (const event of filteredEvents) {
		try {
			const notePath = notePathMap.get(`${event.eventId}::${event.start}`)!;
			console.log(`[CalendarBridge] NOTE_PATH — "${event.title}" start=${event.start} recurring=${event.isRecurring} → ${notePath}`);
			const seriesPagePath = event.isRecurring
				? (() => {
					const sp = getSeriesPath(event.title, { ...settings, seriesFolder });
					return sp.split('/').pop()?.replace(/\.md$/, '') ?? event.title;
				})()
				: undefined;
			// Resolve per-event template via TemplateRoutingService
			const profile = (event.seriesKey && getSeriesProfile)
				? getSeriesProfile(event.seriesKey)
				: undefined;
			const routeResult = resolveTemplatePath({
				event,
				profile,
				routes: settings.templateRoutes ?? [],
				defaultTemplatePath: settings.templatePath,
			});
			console.log(`[CalendarBridge] TEMPLATE_ROUTE — "${event.title}" path="${routeResult.templatePath || '(built-in)'}" reason=${routeResult.reason}${routeResult.matchedRouteId ? ` matchedRoute=${routeResult.matchedRouteId}` : ''}`);
			const eventTemplate = await loadTemplate(routeResult.templatePath);

			// Build note content using the new normalized renderer
			const newContent = fillTemplateNormalized(eventTemplate, {
				event,
				settings: { ...settings, meetingsRoot: notesFolder, seriesRoot: seriesFolder } as PluginSettings,
				seriesPagePath,
				contactMap,
			});

			const existing = app.vault.getAbstractFileByPath(notePath);
			if (existing instanceof TFile) {
				const existingContent = await app.vault.read(existing);

				// Support both old single-block AUTOGEN and new named blocks
				const hasNamedBlocks = existingContent.includes(AUTOGEN_AGENDA_START);
				let updated: string;

				if (hasNamedBlocks) {
					// Extract attendees already in the JOINERS block for union-merge
					const joinersMatch = existingContent.match(
						new RegExp(`<!--\\s*AUTOGEN:JOINERS:START\\s*-->[\\s\\S]*?<!--\\s*AUTOGEN:JOINERS:END\\s*-->`),
					);
					const extraAttendees = joinersMatch
						? extractExistingAttendees(joinersMatch[0])
						: [];

					const agendaBody  = buildAgendaBlock(event);
					const joinersBody = buildJoinersBlock(event, settings as PluginSettings, undefined, contactMap, extraAttendees);
					const linksBody   = buildLinksBlock({ event, seriesPagePath });
					updated = updateAutogenBlocksNamed(existingContent, {
						agendaBody,
						joinersBody,
						linksBody,
					});
				} else {
					updated = updateAutogenBlocks(existingContent, newContent);
				}
				// Apply CB slot injection (idempotent — updates existing CB blocks, no-op if none present)
				updated = injectBlocks(updated, {});

				if (updated !== existingContent) {
					console.log(`[CalendarBridge] NOTE_ACTION — "${event.title}" → UPDATE ${notePath} (AUTOGEN changed)`);
					await app.vault.modify(existing, updated);
					result.updated++;
				} else {
					console.log(`[CalendarBridge] NOTE_ACTION — "${event.title}" → SKIP ${notePath} (no changes)`);
					result.skipped++;
				}
			} else {
				// Ensure the parent folder exists (handles date subfolders like Meetings/2026-02-28/)
				const parentFolder = notePath.includes('/') ? notePath.split('/').slice(0, -1).join('/') : '';
				if (parentFolder) {
					console.log(`[CalendarBridge] ENSURE_FOLDER — "${parentFolder}"`);
					await ensureFolderExists(app, parentFolder);
				}
				console.log(`[CalendarBridge] NOTE_ACTION — "${event.title}" → CREATE ${notePath}`);
				// Apply CB slot injection to new note (handles {{CB_SLOT}} tokens if present)
				const contentWithCb = injectBlocks(newContent, {});
				await app.vault.create(notePath, contentWithCb);
				result.created++;
			}
		} catch (err) {
			const msg = `Failed to sync "${event.title}" (${event.startDate.toISOString()}): ${(err as Error).message}`;
			console.error('[CalendarBridge] WRITE_NOTE_ERROR —', msg, err);
			result.errors.push(msg);
		}
	}

	// ── Create / update series index pages ─────────────────────────────────
	for (const [, series] of seriesMap) {
		const seriesPath = getSeriesPath(series.title, { ...settings, seriesFolder });
		const notePathFn = (e: typeof legacyEvents[0]) => getNotePath(e, pathSettings);

		try {
			const existing = app.vault.getAbstractFileByPath(seriesPath);
			console.log(`[CalendarBridge] SERIES_PATH — "${series.title}" → ${seriesPath}`);
			if (existing instanceof TFile) {
				const existingContent = await app.vault.read(existing);
				const autogenBody     = generateSeriesAutogen(series, notePathFn, now);
				const newBlock        = wrapAutogen(autogenBody);
				const updated         = updateAutogenBlocks(existingContent, newBlock);
				if (updated !== existingContent) {
					console.log(`[CalendarBridge] SERIES_ACTION — "${series.title}" → UPDATE ${seriesPath}`);
					await app.vault.modify(existing, updated);
					result.updated++;
				} else {
					console.log(`[CalendarBridge] SERIES_ACTION — "${series.title}" → SKIP ${seriesPath} (no changes)`);
					result.skipped++;
				}
			} else {
				console.log(`[CalendarBridge] SERIES_ACTION — "${series.title}" → CREATE ${seriesPath}`);
				const content = generateSeriesPageContent(series, notePathFn, now);
				await app.vault.create(seriesPath, content);
				result.created++;
			}
		} catch (err) {
			const msg = `Failed to sync series "${series.title}": ${(err as Error).message}`;
			console.error('[CalendarBridge] WRITE_SERIES_ERROR —', msg, err);
			result.errors.push(msg);
		}
	}


	console.log(`[CalendarBridge] RENDER_TEMPLATES_DONE — template applied to ${filteredEvents.length} event(s)`);
	onProgress?.('completed', 100);
	console.log(`[CalendarBridge] WRITE_FILES_DONE — created:${result.created} updated:${result.updated} skipped:${result.skipped} errors:${result.errors.length}${result.errors.length > 0 ? ' | ' + result.errors.join(' | ') : ''}`);
	result.normalizedEvents = allEvents;
	return result;
}
