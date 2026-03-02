/**
 * ActionAggregationService — carries over incomplete actions from recent series notes.
 *
 * Scans the last N meeting notes in a series, finds action items (lines matching
 * common action patterns), deduplicates them, and returns content for the CB_ACTIONS slot.
 *
 * Action detection heuristics (applied in order):
 *   1. CB_ACTIONS slot content — line-by-line
 *   2. Checkbox items: `- [ ] ...` (incomplete only)
 *   3. Lines under a `## Actions` / `## Action Items` / `## TODO` heading
 *
 * Scope: series-scoped only. Never does a global vault scan.
 * Caching: results are cached per seriesKey for the lifetime of the service instance.
 */

import { App, TFile } from 'obsidian';
import { extractSlotContent } from './TemplateService';

// ─── Config ────────────────────────────────────────────────────────────────────

export interface ActionAggregationOptions {
	/** Maximum number of previous notes to scan. Default: 5. */
	maxLookback?: number;
	/** Vault folder where meeting notes live. */
	notesFolder: string;
	/** Series key used to filter notes by frontmatter. */
	seriesKey: string;
}

// ─── Result ────────────────────────────────────────────────────────────────────

export interface ActionAggregationResult {
	/** Markdown content ready for CB_ACTIONS slot. */
	content: string;
	/** Raw deduplicated action strings (without markdown formatting). */
	actions: string[];
	/** Number of notes scanned. */
	scanned: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ActionAggregationService {
	private cache = new Map<string, ActionAggregationResult>();

	constructor(private app: App) {}

	/**
	 * Aggregate incomplete actions from the last N notes of the series.
	 */
	async aggregateActions(opts: ActionAggregationOptions): Promise<ActionAggregationResult> {
		const { seriesKey, notesFolder, maxLookback = 5 } = opts;

		const cacheKey = `${seriesKey}::${notesFolder}::${maxLookback}`;
		if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

		const result = await this._aggregate(seriesKey, notesFolder, maxLookback);
		this.cache.set(cacheKey, result);
		return result;
	}

	/** Clear all cached results (call between sync runs). */
	clearCache(): void {
		this.cache.clear();
	}

	// ─── Private ───────────────────────────────────────────────────────────────

	private async _aggregate(
		seriesKey: string,
		notesFolder: string,
		maxLookback: number,
	): Promise<ActionAggregationResult> {
		const folder = this.app.vault.getAbstractFileByPath(notesFolder);
		if (!folder) return { content: '', actions: [], scanned: 0 };

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

		seriesFiles.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));
		const candidates = seriesFiles.slice(0, maxLookback);

		const seen = new Set<string>();
		const allActions: string[] = [];

		for (const file of candidates) {
			try {
				const content = await this.app.vault.read(file);
				const extracted = extractActions(content);
				for (const action of extracted) {
					const key = normalizeAction(action);
					if (!seen.has(key)) {
						seen.add(key);
						allActions.push(action);
					}
				}
			} catch {
				// Skip
			}
		}

		const cleanActions = allActions
			.map(a => a.trim())
			.filter(a => a.length > 0)
			// Defensive: never carry over CB markers/comments if they appear in text
			.filter(a => !a.startsWith('<!--'))
			.filter(a => !a.includes('CB:BEGIN') && !a.includes('CB:END'));

		const content = cleanActions.length > 0
			? cleanActions.map(a => `- [ ] ${a}`).join('\n')
			: '';

		return { content, actions: allActions, scanned: candidates.length };
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract incomplete action items from a meeting note.
 * Priority: CB_ACTIONS slot → unchecked checkboxes → action-section lines.
 */
export function extractActions(content: string): string[] {
	const actions: string[] = [];

	// 1. CB_ACTIONS slot
	const slotContent = extractSlotContent(content, 'CB_ACTIONS');
	if (slotContent) {
		for (const line of slotContent.split('\n')) {
			const action = parseActionLine(line);
			if (action) actions.push(action);
		}
		if (actions.length > 0) return actions;
	}

	// 2. Unchecked checkbox items anywhere in the note
	const checkboxRe = /^[-*]\s+\[ \]\s+(.+)$/gm;
	let m: RegExpExecArray | null;
	while ((m = checkboxRe.exec(content)) !== null) {
		actions.push(m[1].trim());
	}
	if (actions.length > 0) return actions;

	// 3. Lines under ## Actions / ## Action Items / ## TODO headings
	// Split on next heading boundary so we get just the section content
	const sectionStart = content.search(/^##\s+(?:Actions?(?:\s+Items?)?|TODO)/im);
	if (sectionStart !== -1) {
		const afterHeading = content.slice(sectionStart).replace(/^[^\n]+\n/, ''); // strip heading line
		// Capture lines until the next ## heading
		const sectionBody = afterHeading.split(/^##/m)[0];
		for (const line of sectionBody.split('\n')) {
			const trimmedLine = line.trim();

			// Skip noise: only list items are valid actions
			if (!trimmedLine) continue;
			if (trimmedLine.startsWith('#')) continue;
			if (trimmedLine.startsWith('```')) continue;
			if (trimmedLine.startsWith('<!--')) continue;
			// Only push lines that are actual list items
			if (!/^[-*]\s+/.test(trimmedLine)) continue;

			const stripped = trimmedLine.replace(/^[-*]\s+/, '').trim();
			if (!stripped) continue;
			actions.push(stripped);
		}
	}

	return actions;
}

/**
 * Parse a line from CB_ACTIONS content as an action item.
 * Accepts: `- [ ] item`, `- [x] item` (skips completed), plain `- item`
 */
function parseActionLine(line: string): string | null {
	const trimmed = line.trim();

	// Ignore HTML comments / CB markers
	if (!trimmed || trimmed.startsWith('<!--')) return null;

	// Completed action — skip
	if (/^[-*]\s+\[x\]/i.test(trimmed)) return null;

	// Unchecked checkbox (require non-empty text after it)
	const unchecked = trimmed.match(/^[-*]\s+\[ \]\s+(.+)$/);
	if (unchecked) {
		const text = unchecked[1].trim();
		return text ? text : null;
	}

	// Plain list item (require non-empty)
	const plain = trimmed.match(/^[-*]\s+(.+)$/);
	if (plain) {
		const text = plain[1].trim();
		return text ? text : null;
	}

	return null;
}

/** Normalize an action string for deduplication (lowercase, collapse whitespace). */
function normalizeAction(action: string): string {
	return action.toLowerCase().replace(/\s+/g, ' ').trim();
}
