/**
 * CbBlocksBuilder — builds a complete CB slot map for every event.
 *
 * Guarantees ALL 9 CB slots are populated (never undefined), so that
 * `injectBlocks` can replace every `{{CB_*}}` token in a meeting note
 * template without leaving any leftover tokens.
 *
 * Slots:
 *   CB_FM          → YAML frontmatter lines (no fences — template provides ---)
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
import { buildFrontmatter, buildLinksBlock } from '../note-generator';
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
	} = params;

	const diagnosticsLines: string[] = [];
	const trace = (msg: string) => {
		if (debugEnabled) diagnosticsLines.push(msg);
	};

	// ── CB_FM: YAML frontmatter lines (without ---) ──────────────────────────
	const fm = buildFrontmatter(event, settings, undefined, contactMap);
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

	// ── CB_CONTEXT / CB_ACTIONS: premium, recurring only ─────────────────────
	let context = '';
	let actions = '';

	if (event.isRecurring && event.seriesKey) {
		try {
			const ctxResult = await contextService.buildContext({
				seriesKey: event.seriesKey,
				notesFolder,
				maxLookback: 3,
			});
			context = ctxResult.content;
			trace(`CB_CONTEXT: ${ctxResult.scanned} notes scanned, ${ctxResult.sourcePaths.length} contributed`);
		} catch (err) {
			trace(`CB_CONTEXT: error — ${(err as Error).message}`);
			// non-fatal — degrade silently
		}

		try {
			const actResult = await actionService.aggregateActions({
				seriesKey: event.seriesKey,
				notesFolder,
				maxLookback: 5,
			});
			actions = actResult.content;
			trace(`CB_ACTIONS: ${actResult.scanned} notes scanned, ${actResult.actions.length} actions found`);
		} catch (err) {
			trace(`CB_ACTIONS: error — ${(err as Error).message}`);
			// non-fatal — degrade silently
		}
	} else {
		trace(`CB_CONTEXT/CB_ACTIONS: skipped (non-recurring or no seriesKey)`);
	}

	// ── CB_DIAGNOSTICS: trace output (debug only) ────────────────────────────
	const diagnostics = debugEnabled && diagnosticsLines.length > 0
		? `**CB Diagnostics** — ${event.title} @ ${event.start}\n\n` +
		  diagnosticsLines.map(l => `- ${l}`).join('\n')
		: '';

	// ── Return complete map — ALL 9 slots, always strings ─────────────────────
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
