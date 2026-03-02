/**
 * ContextService — extracts "pre-meeting context" from recent notes in a series.
 *
 * Reads the last N meeting notes in the series (by file modification time),
 * extracts decisions from their CB_DECISIONS slot (or CB_CONTEXT/## Notes
 * fallback), filters them for staleness, and returns rendered content ready
 * to inject into the CB_CONTEXT slot.
 *
 * Scope: series-scoped only. Never does a global vault scan.
 * Caching: results are cached per seriesKey for the lifetime of the service instance.
 */

import { App, TFile } from 'obsidian';
import { extractSlotContent } from './TemplateService';
import {
	filterDecisions,
	stripStickyToken,
	ExtractedDecision,
	DecisionFilterResult,
} from './DecisionFilter';

// ─── Config ────────────────────────────────────────────────────────────────────

export interface ContextServiceOptions {
	/** Maximum number of previous notes to scan. Default: 3. */
	maxLookback?: number;
	/** Vault folder where meeting notes live. */
	notesFolder: string;
	/** Series key used to filter notes by frontmatter. */
	seriesKey: string;
	/** Days before a decision is considered stale. Default: 14. */
	horizonDays?: number;
	/** When true, decisions with a past embedded date are excluded. Default: true. */
	dropExpiredByDate?: boolean;
	/** Token that marks a decision sticky (always included). Default: '!sticky'. */
	stickyToken?: string;
	/** Injectable "now" for deterministic tests. Default: new Date(). */
	now?: Date;
	/** When true, per-decision debug reasons are appended as a comment. */
	debug?: boolean;
}

// ─── Result ────────────────────────────────────────────────────────────────────

export interface ContextResult {
	/** Markdown content ready for CB_CONTEXT slot (empty string if nothing found). */
	content: string;
	/** Number of notes scanned. */
	scanned: number;
	/** Paths of notes that contributed context. */
	sourcePaths: string[];
	/** Filter result (available for diagnostics). */
	filterResult?: DecisionFilterResult;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ContextService {
	private cache = new Map<string, ContextResult>();

	constructor(private app: App) {}

	/**
	 * Build pre-meeting context from the last N notes of the series.
	 *
	 * Reads notes in the notesFolder that contain `series_key: <seriesKey>` in
	 * their frontmatter, sorted by modification time descending, up to maxLookback.
	 *
	 * For each note, tries (in order):
	 *   1. CB_CONTEXT slot content (if previously injected)
	 *   2. CB_DECISIONS slot content
	 *   3. First 3 non-empty lines after any `## Notes` heading
	 *
	 * Decisions extracted from CB_DECISIONS are then filtered by:
	 *   - sticky token (always kept)
	 *   - embedded date expiry
	 *   - horizon TTL
	 *
	 * Returns empty content when no relevant notes exist.
	 */
	async buildContext(opts: ContextServiceOptions): Promise<ContextResult> {
		const {
			seriesKey,
			notesFolder,
			maxLookback = 3,
			horizonDays = 14,
			dropExpiredByDate = true,
			stickyToken = '!sticky',
			now = new Date(),
			debug = false,
		} = opts;

		const cacheKey = `${seriesKey}::${notesFolder}::${maxLookback}::${horizonDays}::${dropExpiredByDate}::${stickyToken}`;
		if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

		const result = await this._buildContext(
			seriesKey,
			notesFolder,
			maxLookback,
			horizonDays,
			dropExpiredByDate,
			stickyToken,
			now,
			debug,
		);
		this.cache.set(cacheKey, result);
		return result;
	}

	/** Clear all cached results (call between sync runs). */
	clearCache(): void {
		this.cache.clear();
	}

	// ─── Private ───────────────────────────────────────────────────────────────

	private async _buildContext(
		seriesKey: string,
		notesFolder: string,
		maxLookback: number,
		horizonDays: number,
		dropExpiredByDate: boolean,
		stickyToken: string,
		now: Date,
		debug: boolean,
	): Promise<ContextResult> {
		const folder = this.app.vault.getAbstractFileByPath(notesFolder);
		if (!folder) return { content: '', scanned: 0, sourcePaths: [] };

		// Collect all .md files in the notesFolder (non-recursive — series notes are flat)
		const files = this.app.vault.getFiles
			? this.app.vault.getFiles().filter(f => f.path.startsWith(notesFolder + '/') && f.path.endsWith('.md'))
			: [];

		// Filter to only notes belonging to this series
		const seriesFiles: TFile[] = [];
		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				if (content.includes(`series_key: ${seriesKey}`)) {
					seriesFiles.push(file);
				}
			} catch {
				// Skip unreadable files
			}
		}

		// Sort by mtime descending (most recent first), take up to maxLookback
		seriesFiles.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));
		const candidates = seriesFiles.slice(0, maxLookback);

		// Extract decisions with source metadata from each candidate
		const allDecisions: ExtractedDecision[] = [];
		const fallbackSnippets: string[] = [];
		const sourcePaths: string[] = [];

		for (const file of candidates) {
			try {
				const content = await this.app.vault.read(file);
				const sourceDate = this._parseSourceDate(content, file);
				const fileDecisions = extractDecisionsFromNote(content, file.path, sourceDate);

				if (fileDecisions.length > 0) {
					allDecisions.push(...fileDecisions);
					if (!sourcePaths.includes(file.path)) sourcePaths.push(file.path);
				} else {
					// Fall back to CB_CONTEXT slot or ## Notes excerpt
					const fallback = extractFallbackSnippet(content, file.path);
					if (fallback) {
						fallbackSnippets.push(fallback);
						if (!sourcePaths.includes(file.path)) sourcePaths.push(file.path);
					}
				}
			} catch {
				// Skip
			}
		}

		// Run decision filter
		let filteredContent = '';
		let filterResult: DecisionFilterResult | undefined;

		if (allDecisions.length > 0) {
			filterResult = filterDecisions(allDecisions, {
				now,
				horizonDays,
				dropExpiredByDate,
				stickyToken,
				debug,
			});

			filteredContent = renderFilteredDecisions(filterResult, stickyToken, debug);
		}

		// Combine filtered decisions with any fallback snippets
		const parts: string[] = [];
		if (filteredContent) parts.push(filteredContent);
		if (fallbackSnippets.length > 0) parts.push(fallbackSnippets.join('\n\n'));

		const joined = parts.join('\n\n');
		return {
			content: joined,
			scanned: candidates.length,
			sourcePaths,
			filterResult,
		};
	}

	/**
	 * Parse the source date for a note, trying:
	 *   1. frontmatter `start:` or `date:` field
	 *   2. YYYY-MM-DD pattern in filename
	 *   3. file mtime fallback
	 */
	private _parseSourceDate(content: string, file: TFile): Date {
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract individual decisions from a note's CB_DECISIONS slot.
 * Returns one ExtractedDecision per non-empty bullet line.
 */
export function extractDecisionsFromNote(
	content: string,
	sourcePath: string,
	sourceDate: Date,
): ExtractedDecision[] {
	const dec = extractSlotContent(content, 'CB_DECISIONS');
	if (!dec || !dec.trim()) return [];

	const lines = dec
		.split('\n')
		.map(l => l.trim())
		.filter(l => l.length > 0);

	return lines.map(text => ({ text, sourcePath, sourceDate }));
}

/**
 * Extract a non-decisions fallback snippet (CB_CONTEXT slot or ## Notes excerpt).
 * Used when a note has no CB_DECISIONS content.
 */
export function extractFallbackSnippet(content: string, sourcePath: string): string {
	// CB_CONTEXT slot
	const ctx = extractSlotContent(content, 'CB_CONTEXT');
	if (ctx && ctx.trim()) return `<!-- from ${sourcePath} -->\n${ctx.trim()}`;

	// Fallback: first 3 non-empty lines after ## Notes
	const notesStart = content.search(/^##\s+Notes/im);
	if (notesStart !== -1) {
		const afterHeading = content.slice(notesStart).replace(/^[^\n]+\n/, '');
		const sectionBody = afterHeading.split(/^##/m)[0];
		const lines = sectionBody.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3);
		if (lines.length > 0) {
			return `<!-- from ${sourcePath} (notes excerpt) -->\n${lines.join('\n')}`;
		}
	}

	return '';
}

/**
 * Render filtered decisions to a markdown string for the CB_CONTEXT slot.
 * Strips the stickyToken from display output.
 */
function renderFilteredDecisions(
	result: DecisionFilterResult,
	stickyToken: string,
	debug: boolean,
): string {
	const lines: string[] = [];

	for (const decision of result.included) {
		const displayText = stripStickyToken(decision.text, stickyToken);
		lines.push(displayText);
	}

	if (debug && result.excluded.length > 0) {
		lines.push('');
		lines.push('<!-- CB_CONTEXT filter stats:');
		for (const [key, count] of Object.entries(result.stats)) {
			if (count > 0) lines.push(`  ${key}: ${count}`);
		}
		lines.push('-->');
	}

	return lines.join('\n');
}

/**
 * @deprecated Preserved for backward-compatibility. Use extractDecisionsFromNote
 * + extractFallbackSnippet instead.
 *
 * Extract a brief context snippet from a meeting note.
 * Priority: CB_CONTEXT slot → CB_DECISIONS slot → first few lines after ## Notes.
 */
export function extractContextSnippet(content: string, sourcePath: string): string {
	// 1. CB_CONTEXT slot
	const ctx = extractSlotContent(content, 'CB_CONTEXT');
	if (ctx && ctx.trim()) return `<!-- from ${sourcePath} -->\n${ctx.trim()}`;

	// 2. CB_DECISIONS slot
	const dec = extractSlotContent(content, 'CB_DECISIONS');
	if (dec && dec.trim()) return `<!-- from ${sourcePath} (decisions) -->\n${dec.trim()}`;

	// 3. Fallback: first 3 non-empty lines after ## Notes
	const notesStart = content.search(/^##\s+Notes/im);
	if (notesStart !== -1) {
		const afterHeading = content.slice(notesStart).replace(/^[^\n]+\n/, '');
		const sectionBody = afterHeading.split(/^##/m)[0];
		const lines = sectionBody.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3);
		if (lines.length > 0) {
			return `<!-- from ${sourcePath} (notes excerpt) -->\n${lines.join('\n')}`;
		}
	}

	return '';
}
