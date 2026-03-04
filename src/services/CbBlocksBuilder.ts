/**
 * CbBlocksBuilder — builds a complete CB slot map for every event.
 *
 * Guarantees ALL 9 CB slots are populated (never undefined), so that
 * `injectBlocks` can replace every `{{CB_*}}` token in a meeting note
 * template without leaving any leftover tokens.
 *
 * Slots:
 *   CB_FM          → YAML frontmatter lines (no fences — wrapSlot adds them)
 *   CB_HEADER      → structured header: time, calendar, recurrence flag
 *   CB_LINKS       → meet/zoom/teams links + series link
 *   CB_CONTEXT     → pre-meeting context from recent series notes (recurring only)
 *   CB_ACTIONS     → carried-over incomplete actions (recurring only)
 *   CB_BODY        → empty placeholder (user's zone)
 *   CB_DECISIONS   → empty placeholder (user's zone)
 *   CB_DIAGNOSTICS → debug trace (only when settings.debug is true)
 *   CB_FOOTER      → empty placeholder
 */

import { App } from 'obsidian';
import { CbSlot } from './TemplateService';
import { NormalizedEvent, PluginSettings } from '../types';
import { ContextService } from './ContextService';
import { ActionAggregationService } from './ActionAggregationService';
import { buildFrontmatter, buildLinksBlock, FrontmatterOverrides } from '../note-generator';
import { ContactMap } from '../contacts';

// ─── Params ──────────────────────────────────────────────────────────────────

export interface BuildCbBlocksParams {
	app: App;
	event: NormalizedEvent;
	settings: PluginSettings;
	notesFolder: string;
	seriesFolder: string;
	seriesPagePath?: string;
	contactMap: ContactMap;
	contextService: ContextService;
	actionService: ActionAggregationService;
	/** When true, CB_DIAGNOSTICS is populated with a trace block. */
	debugEnabled?: boolean;
	/** Overrides for frontmatter values (e.g., preserved draft/attendees from existing note). */
	frontmatterOverrides?: FrontmatterOverrides;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build a complete Record<CbSlot, string> for a single event.
 * Every slot is guaranteed to be a string (never undefined).
 */
export async function buildCbBlocks(
	params: BuildCbBlocksParams,
): Promise<Record<CbSlot, string>> {
	const {
		event,
		settings,
		notesFolder,
		seriesPagePath,
		contactMap,
		contextService,
		actionService,
		debugEnabled = false,
		frontmatterOverrides,
	} = params;

	const diagnosticsLines: string[] = [];
	const trace = (msg: string) => {
		if (debugEnabled) diagnosticsLines.push(msg);
	};

	// ── CB_FM: YAML frontmatter lines (without ---) ──────────────────────────
	const fm = buildFrontmatter(event, settings, undefined, contactMap, frontmatterOverrides);
	trace(`CB_FM: ${fm.split('\n').length} lines`);

	// ── CB_HEADER: compact structured header ────────────────────────────────
	const header = buildHeaderBlock(event, settings);
	trace(`CB_HEADER: built`);

	// ── CB_LINKS: meeting join URLs + series page link ───────────────────────
	const links = buildLinksBlock({
		event,
		seriesPagePath,
		cancelled: event.status === 'cancelled',
	});
	trace(`CB_LINKS: built`);

	// ── CB_CONTEXT / CB_ACTIONS: redirect to series note (series note is now the canonical source) ──
	let context = '';
	let actions = '';

	if (event.isRecurring && event.seriesKey && seriesPagePath) {
		const seriesLink = `[[${seriesPagePath}]]`;
		context = `> Aggregated context is in the series note: ${seriesLink}`;
		actions = `> Open series actions are tracked in the series note: ${seriesLink}`;
		trace(`CB_CONTEXT/CB_ACTIONS: redirected to series note`);
	} else if (event.isRecurring && event.seriesKey) {
		context = '> See the series note for aggregated context.';
		actions = '> See the series note for open actions.';
		trace(`CB_CONTEXT/CB_ACTIONS: redirected (no seriesPagePath)`);
	} else {
		trace(`CB_CONTEXT/CB_ACTIONS: skipped (non-recurring or no seriesKey)`);
	}
	// ── CB_SERIES_LINK: wikilink to series note ──────────────────────────────
	const seriesLink = (event.isRecurring && seriesPagePath)
		? `Related series: [[${seriesPagePath}]]`
		: '';
	trace(`CB_SERIES_LINK: ${seriesLink ? 'set' : 'empty'}`);

	// ── CB_DIAGNOSTICS: trace output (debug only) ────────────────────────────
	const diagnostics = debugEnabled && diagnosticsLines.length > 0
		? `**CB Diagnostics** — ${event.title} @ ${event.start}\n\n` +
		  diagnosticsLines.map(l => `- ${l}`).join('\n')
		: '';

	// ── Return complete map — ALL 10 slots, always strings ─────────────────────
	return {
		CB_FM:          fm,
		CB_HEADER:      header,
		CB_LINKS:       links,
		CB_CONTEXT:     context,
		CB_ACTIONS:     actions,
		CB_BODY:        '',
		CB_DECISIONS:   '',
		CB_DIAGNOSTICS: diagnostics,
		CB_FOOTER:      '',
		CB_SERIES_LINK: seriesLink,
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a compact structured header block for a meeting note.
 *
 * Format:
 *   ## <title>
 *
 *   **Calendar:** <sourceName>
 *   **Time:** <start> – <end> (<timezone>)
 *   **Recurring:** Yes   (only for recurring events)
 */
function buildHeaderBlock(event: NormalizedEvent, settings: PluginSettings): string {
	const timeFormat = settings.timeFormat ?? 'HH:mm';
	const dateFormat = settings.dateFormat ?? 'YYYY-MM-DD';
	const tz = event.timezone ?? settings.timezoneDefault ?? '';

	const formatDate = (date: Date, fmt: string): string => {
		const pad = (n: number) => String(n).padStart(2, '0');
		return fmt
			.replace('YYYY', String(date.getFullYear()))
			.replace('MM',   pad(date.getMonth() + 1))
			.replace('DD',   pad(date.getDate()))
			.replace('HH',   pad(date.getHours()))
			.replace('mm',   pad(date.getMinutes()))
			.replace('ss',   pad(date.getSeconds()));
	};

	const lines: string[] = [`## ${event.title}`, ''];

	lines.push(`**Calendar:** ${event.sourceName}`);

	if (event.isAllDay) {
		lines.push(`**Date:** ${formatDate(event.startDate, dateFormat)}`);
	} else {
		const dateStr  = formatDate(event.startDate, dateFormat);
		const startStr = formatDate(event.startDate, timeFormat);
		const endStr   = formatDate(event.endDate, timeFormat);
		const tzSuffix = tz ? ` (${tz})` : '';
		lines.push(`**Time:** ${dateStr} ${startStr} – ${endStr}${tzSuffix}`);
	}

	if (event.isRecurring) {
		lines.push(`**Recurring:** Yes`);
	}

	if (event.status === 'cancelled') {
		lines.push('');
		lines.push('> ⚠️ This event was **cancelled**.');
	}

	return lines.join('\n');
}
