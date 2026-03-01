/**
 * MetricsService — computes health metrics for a meeting series.
 *
 * Metrics produced:
 *   - totalNotes       : number of meeting notes found for this series
 *   - lastMeetingDate  : ISO date string of the most recent meeting
 *   - avgAttendeeCount : average number of attendees across all notes
 *   - completionRate   : ratio of notes that have CB_DECISIONS or any completed actions
 *   - openActionCount  : total incomplete actions across all scanned notes
 *
 * Returns a markdown string suitable for injecting into a series (_series) page.
 *
 * Scope: series-scoped only. Never does a global vault scan.
 * Caching: results are cached per seriesKey + notesFolder.
 */

import { App, TFile } from 'obsidian';
import { extractSlotContent } from './TemplateService';

// ─── Config ────────────────────────────────────────────────────────────────────

export interface MetricsOptions {
	/** Series key used to filter notes by frontmatter. */
	seriesKey: string;
	/** Vault folder where meeting notes live. */
	notesFolder: string;
	/** Maximum number of notes to scan for action count. Default: 20. */
	maxScan?: number;
}

// ─── Result ────────────────────────────────────────────────────────────────────

export interface SeriesMetrics {
	totalNotes: number;
	lastMeetingDate: string | null;
	avgAttendeeCount: number;
	completionRate: number;
	openActionCount: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class MetricsService {
	private cache = new Map<string, SeriesMetrics>();

	constructor(private app: App) {}

	/**
	 * Compute series health metrics from vault notes.
	 * Returns cached result if called again with the same key + folder.
	 */
	async computeMetrics(opts: MetricsOptions): Promise<SeriesMetrics> {
		const { seriesKey, notesFolder, maxScan = 20 } = opts;
		const cacheKey = `${seriesKey}::${notesFolder}::${maxScan}`;
		if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

		const result = await this._compute(seriesKey, notesFolder, maxScan);
		this.cache.set(cacheKey, result);
		return result;
	}

	/**
	 * Render metrics as a compact markdown block for injection into a series page.
	 */
	async renderMetricsBlock(opts: MetricsOptions): Promise<string> {
		const m = await this.computeMetrics(opts);
		return formatMetrics(m);
	}

	/** Clear all cached results. */
	clearCache(): void {
		this.cache.clear();
	}

	// ─── Private ───────────────────────────────────────────────────────────────

	private async _compute(
		seriesKey: string,
		notesFolder: string,
		maxScan: number,
	): Promise<SeriesMetrics> {
		const folderExists = this.app.vault.getAbstractFileByPath(notesFolder);
		if (!folderExists) {
			return { totalNotes: 0, lastMeetingDate: null, avgAttendeeCount: 0, completionRate: 0, openActionCount: 0 };
		}

		const files = this.app.vault.getFiles
			? this.app.vault.getFiles().filter(f => f.path.startsWith(notesFolder + '/') && f.path.endsWith('.md'))
			: [];

		const seriesFiles: TFile[] = [];
		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				if (content.includes(`series_key: ${seriesKey}`)) {
					seriesFiles.push(file);
				}
			} catch {
				// Skip
			}
		}

		if (seriesFiles.length === 0) {
			return { totalNotes: 0, lastMeetingDate: null, avgAttendeeCount: 0, completionRate: 0, openActionCount: 0 };
		}

		// Sort by mtime descending
		seriesFiles.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));

		const totalNotes = seriesFiles.length;
		const lastMeetingDate = extractStartDate(await this.app.vault.read(seriesFiles[0]));

		const candidates = seriesFiles.slice(0, maxScan);
		let totalAttendees = 0;
		let notesWithContent = 0;
		let openActionCount = 0;

		for (const file of candidates) {
			try {
				const content = await this.app.vault.read(file);
				totalAttendees += countAttendees(content);

				const hasDecisions = !!extractSlotContent(content, 'CB_DECISIONS')?.trim();
				const hasCompletedAction = /^[-*]\s+\[x\]/im.test(content);
				if (hasDecisions || hasCompletedAction) notesWithContent++;

				// Count open checkboxes
				const openMatches = content.match(/^[-*]\s+\[ \]/gm);
				if (openMatches) openActionCount += openMatches.length;
			} catch {
				// Skip
			}
		}

		const avgAttendeeCount = totalNotes > 0 ? Math.round((totalAttendees / candidates.length) * 10) / 10 : 0;
		const completionRate = candidates.length > 0 ? Math.round((notesWithContent / candidates.length) * 100) : 0;

		return { totalNotes, lastMeetingDate, avgAttendeeCount, completionRate, openActionCount };
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the `start:` frontmatter value from a note. */
function extractStartDate(content: string): string | null {
	const m = content.match(/^start:\s*(.+)$/m);
	return m ? m[1].trim().slice(0, 10) : null;
}

/** Count attendees listed in a note's frontmatter `attendees:` array. */
function countAttendees(content: string): number {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return 0;
	const attendeesMatch = fmMatch[1].match(/^attendees:/m);
	if (!attendeesMatch) return 0;
	// Count `  - ` list items following attendees:
	const listItems = fmMatch[1].match(/^  - /gm);
	return listItems ? listItems.length : 0;
}

/** Format a SeriesMetrics object as a markdown snippet. */
export function formatMetrics(m: SeriesMetrics): string {
	const lines = [
		`| Metric | Value |`,
		`|--------|-------|`,
		`| Notes | ${m.totalNotes} |`,
		`| Last meeting | ${m.lastMeetingDate ?? '—'} |`,
		`| Avg attendees | ${m.avgAttendeeCount} |`,
		`| Completion rate | ${m.completionRate}% |`,
		`| Open actions | ${m.openActionCount} |`,
	];
	return lines.join('\n');
}
