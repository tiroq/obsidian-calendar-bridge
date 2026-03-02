/**
 * SeriesNoteService — maintains the canonical series note.
 *
 * Writes four CB_SERIES_* blocks into the series note (idempotent):
 *   CB_SERIES_ACTIONS        — open tasks marked with the seriesActionMarker (default `^series`)
 *   CB_SERIES_DECISIONS      — filtered decisions from CB_DECISIONS slots across meeting notes
 *   CB_SERIES_MEETINGS_INDEX — reverse-chron wikilink list of all meetings
 *   CB_SERIES_DIAGNOSTICS    — scan statistics
 *
 * Called AFTER all meeting notes are written in each sync run (second pass).
 *
 * Architectural rule: this service returns raw markdown content (no CB markers).
 * TemplateService.injectBlocks() is responsible for wrapping with CB markers.
 */

import { App, TFile } from 'obsidian';
import { CB_SERIES_SLOTS, CbSeriesSlot, PluginSettings } from '../types';
import { injectBlocks, extractSlotContent } from './TemplateService';
import { resolveSeriesTemplate, applySeriesVariables } from '../utils/TemplateResolver';
import { ensureSeriesBlocksExist } from '../utils/SeriesTemplate';
import {
	filterDecisions,
	ExtractedDecision,
} from './DecisionFilter';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Update (or initialize) the series note at `seriesNotePath` using the
 * given list of meeting note files that belong to the series.
 *
 * @param app             Obsidian App instance
 * @param seriesNotePath  Vault path of the series note
 * @param seriesName      Human-readable series title (for diagnostics)
 * @param meetingFiles    All TFiles belonging to this series (pre-filtered)
 * @param settings        Plugin settings
 * @param now             Injectable reference time (for deterministic tests)
 */
export async function updateSeriesNote(
	app: App,
	seriesNotePath: string,
	seriesKey: string,
	seriesName: string,
	meetingFiles: TFile[],
	settings: PluginSettings,
	now: Date = new Date(),
): Promise<void> {
	const seriesFile = await getOrCreateSeriesNote(app, seriesNotePath, seriesKey, seriesName, settings);

	const existingContent = await app.vault.read(seriesFile);

	const marker      = settings.seriesActionMarker ?? '^series';
	const horizonDays = settings.seriesDecisionHorizonDays ?? 14;
	const lookback    = settings.seriesDecisionLookbackNotes ?? 30;
	const dropByDate  = settings.seriesDropExpiredDecisionsByDate ?? true;
	const stickyToken = settings.contextStickyToken ?? '!sticky';

	// Sort meeting files by mtime descending (most recent first)
	const sorted = [...meetingFiles].sort(
		(a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0),
	);
	const candidates = sorted.slice(0, lookback);

	// ── Scan meeting notes ───────────────────────────────────────────────────
	const seriesActions: string[]  = [];
	const allDecisions: ExtractedDecision[] = [];
	const meetingLinks: string[] = [];

	for (const file of sorted) {
		// Build wikilink (basename without .md)
		const basename = file.name.replace(/\.md$/, '');
		meetingLinks.push(`- [[${basename}]]`);
	}

	for (const file of candidates) {
		let content: string;
		try {
			content = await app.vault.read(file);
		} catch {
			continue; // unreadable — skip
		}

		// Extract ^series tasks (incomplete only)
		const taskLines = extractSeriesTasks(content, marker);
		seriesActions.push(...taskLines);

		// Extract decisions from CB_DECISIONS slot
		const sourceDate = parseNoteDate(content, file);
		const decisions  = extractDecisionsFromSlot(content, file.path, sourceDate);
		allDecisions.push(...decisions);
	}

	// ── Filter decisions ─────────────────────────────────────────────────────
	let decisionsContent = '';
	if (allDecisions.length > 0) {
		const filterResult = filterDecisions(allDecisions, {
			now,
			horizonDays,
			dropExpiredByDate: dropByDate,
			stickyToken,
		});
		decisionsContent = filterResult.included
			.map(d => d.text)
			.join('\n');
	}

	// ── Build block bodies (raw — no CB markers) ──────────────────────────────
	const actionsBody    = seriesActions.length > 0
		? seriesActions.join('\n')
		: '*(No open series actions)*';

	const decisionsBody  = decisionsContent.trim()
		? decisionsContent.trim()
		: '*(No active decisions)*';

	const meetingsBody   = meetingLinks.length > 0
		? meetingLinks.join('\n')
		: '*(No meetings synced yet)*';

	const diagnosticsBody = buildDiagnosticsBody({
		seriesName,
		totalMeetings:   meetingFiles.length,
		scanned:         candidates.length,
		actionsFound:    seriesActions.length,
		decisionsFound:  allDecisions.length,
		decisionsKept:   decisionsContent.split('\n').filter(Boolean).length,
		now,
	});

	// ── Inject all 4 series blocks (idempotent) ───────────────────────────────
	const blocks: Partial<Record<string, string>> = {
		CB_SERIES_ACTIONS:        actionsBody,
		CB_SERIES_DECISIONS:      decisionsBody,
		CB_SERIES_MEETINGS_INDEX: meetingsBody,
		CB_SERIES_DIAGNOSTICS:    diagnosticsBody,
	};

	const updated = injectBlocks(
		existingContent,
		blocks,
		{},
		CB_SERIES_SLOTS as unknown as readonly string[],
	);

	if (updated !== existingContent) {
		await app.vault.modify(seriesFile, updated);
	}
}

export async function getOrCreateSeriesNote(
	app: App,
	seriesNotePath: string,
	seriesKey: string,
	seriesName: string,
	settings: PluginSettings,
): Promise<TFile> {
	const existing = app.vault.getAbstractFileByPath(seriesNotePath);
	if (existing instanceof TFile) {
		return existing;
	}

	const template = await resolveSeriesTemplate(app, settings);
	const contentWithVars = applySeriesVariables(template, {
		seriesKey,
		seriesName,
		meetingsFolder: settings.meetingsRoot,
	});
	const content = ensureSeriesBlocksExist(contentWithVars);

	const parentPath = seriesNotePath.split('/').slice(0, -1).join('/');
	if (parentPath && !app.vault.getAbstractFileByPath(parentPath)) {
		await app.vault.createFolder(parentPath);
	}

	const created = await app.vault.create(seriesNotePath, content);
	console.log('[CalendarBridge] Created series note:', seriesNotePath, '(template:', settings.seriesTemplatePath || 'default', ')');
	return created;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract incomplete tasks that carry the series marker.
 *
 * Matches lines of the form:
 *   - [ ] Some task text ^series
 *   * [ ] Another task ^series
 *
 * Only INCOMPLETE tasks ([ ]) are included.
 * The marker suffix is stripped from the returned text.
 */
export function extractSeriesTasks(content: string, marker: string): string[] {
	const escapedMarker = escapeRegExp(marker);
	const re = new RegExp(
		`^\\s*[-*]\\s+\\[[ ]\\]\\s+(.+?)\\s*${escapedMarker}\\s*$`,
		'gm',
	);
	const results: string[] = [];
	for (const m of content.matchAll(re)) {
		results.push(`- [ ] ${m[1].trim()}`);
	}
	return results;
}

/**
 * Extract decisions from a note's CB_DECISIONS slot.
 * Returns one ExtractedDecision per non-empty bullet line.
 */
export function extractDecisionsFromSlot(
	content: string,
	sourcePath: string,
	sourceDate: Date,
): ExtractedDecision[] {
	const dec = extractSlotContent(content, 'CB_DECISIONS');
	if (!dec || !dec.trim()) return [];
	return dec
		.split('\n')
		.map(l => l.trim())
		.filter(l => l.length > 0)
		.map(text => ({ text, sourcePath, sourceDate }));
}

/**
 * Parse the source date for a note, trying:
 *   1. frontmatter `start:` or `date:` field
 *   2. YYYY-MM-DD pattern in filename
 *   3. file mtime fallback
 */
export function parseNoteDate(content: string, file: TFile): Date {
	// 1. frontmatter start: or date:
	const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
	if (fmMatch) {
		const fmBlock = fmMatch[1];
		const startMatch = /^(?:start|date):\s*(.+)$/m.exec(fmBlock);
		if (startMatch) {
			const d = new Date(startMatch[1].trim().replace(/^['"]|['"]$/g, ''));
			if (!isNaN(d.getTime())) return d;
		}
	}
	// 2. YYYY-MM-DD in filename
	const nameMatch = /(\d{4})-(\d{2})-(\d{2})/.exec(file.name);
	if (nameMatch) {
		const d = new Date(
			parseInt(nameMatch[1], 10),
			parseInt(nameMatch[2], 10) - 1,
			parseInt(nameMatch[3], 10),
		);
		if (!isNaN(d.getTime())) return d;
	}
	// 3. mtime fallback
	return new Date(file.stat?.mtime ?? Date.now());
}

function buildDiagnosticsBody(opts: {
	seriesName: string;
	totalMeetings: number;
	scanned: number;
	actionsFound: number;
	decisionsFound: number;
	decisionsKept: number;
	now: Date;
}): string {
	const ts = opts.now.toISOString();
	return [
		`**Last updated:** ${ts}`,
		`**Series:** ${opts.seriesName}`,
		`**Total meetings:** ${opts.totalMeetings} | **Scanned:** ${opts.scanned}`,
		`**Series actions found:** ${opts.actionsFound}`,
		`**Decisions found:** ${opts.decisionsFound} | **Kept after filter:** ${opts.decisionsKept}`,
	].join('\n');
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
