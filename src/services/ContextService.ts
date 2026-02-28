/**
 * ContextService — extracts "pre-meeting context" from recent notes in a series.
 *
 * Reads the last N meeting notes in the series (by file modification time),
 * extracts a summary of their context slot (or a fallback excerpt), and
 * returns content ready to inject into the CB_CONTEXT slot.
 *
 * Scope: series-scoped only. Never does a global vault scan.
 * Caching: results are cached per seriesKey for the lifetime of the service instance.
 */

import { App, TFile } from 'obsidian';
import { extractSlotContent } from './TemplateService';

// ─── Config ────────────────────────────────────────────────────────────────────

export interface ContextServiceOptions {
	/** Maximum number of previous notes to scan. Default: 3. */
	maxLookback?: number;
	/** Vault folder where meeting notes live. */
	notesFolder: string;
	/** Series key used to filter notes by frontmatter. */
	seriesKey: string;
}

// ─── Result ────────────────────────────────────────────────────────────────────

export interface ContextResult {
	/** Markdown content ready for CB_CONTEXT slot (empty string if nothing found). */
	content: string;
	/** Number of notes scanned. */
	scanned: number;
	/** Paths of notes that contributed context. */
	sourcePaths: string[];
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
	 * Returns empty content when no relevant notes exist.
	 */
	async buildContext(opts: ContextServiceOptions): Promise<ContextResult> {
		const { seriesKey, notesFolder, maxLookback = 3 } = opts;

		const cacheKey = `${seriesKey}::${notesFolder}::${maxLookback}`;
		if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

		const result = await this._buildContext(seriesKey, notesFolder, maxLookback);
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

		const snippets: string[] = [];
		const sourcePaths: string[] = [];

		for (const file of candidates) {
			try {
				const content = await this.app.vault.read(file);
				const snippet = extractContextSnippet(content, file.path);
				if (snippet) {
					snippets.push(snippet);
					sourcePaths.push(file.path);
				}
			} catch {
				// Skip
			}
		}

		const joined = snippets.join('\n\n');
		return {
			content: joined,
			scanned: candidates.length,
			sourcePaths,
		};
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
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
