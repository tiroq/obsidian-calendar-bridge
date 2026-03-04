/**
 * CleanupService — identifies and removes draft meeting notes for a disabled series.
 *
 * A note is eligible for deletion when ALL three conditions hold:
 *   1. Its frontmatter contains `series_key: <seriesKey>`
 *   2. Its frontmatter contains `draft: true`
 *   3. It has no meaningful user content outside AUTOGEN / CB managed blocks
 *
 * The series index page (seriesRoot/<slug>.md) is intentionally NOT deleted.
 */

import { App, TFile } from 'obsidian';

// ─── Content analysis ─────────────────────────────────────────────────────────

/**
 * Strip all managed blocks from `content` and return what remains.
 * Managed blocks:
 *   <!-- AUTOGEN:…:START --> … <!-- AUTOGEN:…:END -->
 *   <!-- AUTOGEN:START --> … <!-- AUTOGEN:END -->
 *   <!-- CB:BEGIN … --> … <!-- CB:END … -->
 *   YAML frontmatter (--- … ---)
 */
function stripManagedBlocks(content: string): string {
	return content
		// Frontmatter
		.replace(/^---[\s\S]*?^---\s*\n?/m, '')
		// Named AUTOGEN blocks
		.replace(/<!--\s*AUTOGEN:[A-Z_]+:START\s*-->[\s\S]*?<!--\s*AUTOGEN:[A-Z_]+:END\s*-->/g, '')
		// Legacy single AUTOGEN block
		.replace(/<!--\s*AUTOGEN:START\s*-->[\s\S]*?<!--\s*AUTOGEN:END\s*-->/g, '')
		// CB blocks
		.replace(/<!--\s*CB:BEGIN\s+\S+\s*-->[\s\S]*?<!--\s*CB:END\s+\S+\s*-->/g, '');
}

/**
 * Returns true when the note has non-empty sections the user likely wrote
 * (content outside all AUTOGEN / CB blocks that isn't just whitespace /
 * markdown headings).
 *
 * Strategy: strip all managed blocks, then check whether any remaining line
 * has substantive text (not blank, not a heading-only line like `## Notes`).
 */
export function hasMeaningfulContent(content: string): boolean {
	const stripped = stripManagedBlocks(content);
	return stripped
		.split('\n')
		.some(line => {
			const trimmed = line.trim();
			if (!trimmed) return false;
			// Pure heading line (e.g. "## Notes") counts as scaffolding, not user content
			if (/^#{1,6}\s+\S+/.test(trimmed) && trimmed.replace(/^#{1,6}\s+/, '').trim().length < 60) {
				// Heading with only a short title — treat as scaffolding
				return false;
			}
			return true;
		});
}

// ─── Vault scanning ───────────────────────────────────────────────────────────

export interface DraftNoteResult {
	/** Notes safe to delete (draft: true, no meaningful content). */
	deletable: TFile[];
	/** Notes that are draft but contain user content — skipped. */
	skipped: TFile[];
}

/**
 * Scan the vault for meeting notes that belong to `seriesKey` and are
 * draft notes without meaningful user content.
 *
 * Only files under `meetingsRoot` are scanned.
 */
export async function findDraftNotesForSeries(
	app: App,
	seriesKey: string,
	meetingsRoot: string,
): Promise<DraftNoteResult> {
	const deletable: TFile[] = [];
	const skipped: TFile[] = [];

	const allFiles = app.vault.getFiles ? app.vault.getFiles() : [];
	for (const file of allFiles) {
		if (!file.path.startsWith(meetingsRoot + '/') || !file.path.endsWith('.md')) continue;

		let content: string;
		try {
			content = await app.vault.read(file);
		} catch {
			continue; // unreadable — skip
		}

		// Must have matching series_key
		if (!content.includes(`series_key: ${seriesKey}`)) continue;

		// Must be a draft
		if (!/^draft:\s*true\s*$/m.test(content)) continue;

		// Check for user content
		if (hasMeaningfulContent(content)) {
			skipped.push(file);
		} else {
			deletable.push(file);
		}
	}

	// Stable order: by path
	deletable.sort((a, b) => a.path.localeCompare(b.path));
	skipped.sort((a, b) => a.path.localeCompare(b.path));

	return { deletable, skipped };
}

/**
 * Delete (trash) the given files via Obsidian's vault API.
 * Returns the count of successfully deleted files.
 */
export async function deleteNotes(app: App, files: TFile[]): Promise<number> {
	let deleted = 0;
	for (const file of files) {
		try {
			await app.vault.trash(file, true);
			console.log(`[CalendarBridge] CLEANUP — deleted draft note: ${file.path}`);
			deleted++;
		} catch (err) {
			console.warn(`[CalendarBridge] CLEANUP — failed to delete ${file.path}:`, err);
		}
	}
	return deleted;
}
