/**
 * Contact index builder for Calendar Bridge.
 *
 * Scans a vault folder (recursively) for Markdown files that have an
 * `email:` frontmatter key.  Returns a Map<lowerCaseEmail, noteBaseName>
 * that the note generator uses to render attendees as [[WikiLinks]].
 *
 * Supported frontmatter shapes:
 *   email: alice@example.com
 *   email: [alice@example.com, alice@work.com]
 */

import { App, TFile, TFolder } from 'obsidian';

/** Map from lowercase email address → note base name (no .md extension). */
export type ContactMap = Map<string, string>;

/**
 * Collect all TFile instances under a vault folder path (recursively).
 * Returns an empty array when the folder doesn't exist.
 */
function collectMarkdownFiles(app: App, folderPath: string): TFile[] {
	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) return [];

	const results: TFile[] = [];
	const visit = (f: TFolder) => {
		for (const child of f.children) {
			if (child instanceof TFile && child.extension === 'md') {
				results.push(child);
			} else if (child instanceof TFolder) {
				visit(child);
			}
		}
	};
	visit(folder);
	return results;
}

/**
 * Parse a raw YAML value for the `email` field into a list of email strings.
 * Handles both scalar (`email: foo@bar.com`) and YAML list
 * (`email:\n  - foo@bar.com\n  - baz@bar.com`).
 */
function parseEmailField(raw: unknown): string[] {
	if (typeof raw === 'string') {
		return raw
			.split(/[,;]+/)
			.map(s => s.trim())
			.filter(Boolean);
	}
	if (Array.isArray(raw)) {
		return raw
			.flatMap(v => (typeof v === 'string' ? v.split(/[,;]+/) : []))
			.map(s => s.trim())
			.filter(Boolean);
	}
	return [];
}

/**
 * Lightweight frontmatter extractor — reads only the YAML block between
 * the first pair of `---` fences.  Returns a plain key→value record.
 *
 * We do not want to pull in a full YAML parser dependency, so this handles
 * the common cases found in Person notes:
 *   - Scalar strings
 *   - Quoted strings
 *   - Inline lists: [a, b]
 *   - Block sequence lists:
 *       email:
 *         - a@b.com
 */
function extractFrontmatter(content: string): Record<string, unknown> {
	const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!fmMatch) return {};

	const yamlText = fmMatch[1];
	const result: Record<string, unknown> = {};

	// State for block-list accumulation
	let currentKey: string | null = null;
	let listValues: string[] | null = null;

	const flushList = () => {
		if (currentKey !== null && listValues !== null) {
			result[currentKey] = listValues;
		}
		currentKey = null;
		listValues = null;
	};

	for (const rawLine of yamlText.split(/\r?\n/)) {
		// Block list item under the current key
		if (listValues !== null && /^\s+-\s+/.test(rawLine)) {
			listValues.push(rawLine.replace(/^\s+-\s+/, '').trim().replace(/^['"]|['"]$/g, ''));
			continue;
		}

		// A new top-level key (non-indented) — flush previous list if any
		const keyMatch = rawLine.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)/);
		if (!keyMatch) {
			if (!/^\s+-/.test(rawLine)) flushList();
			continue;
		}

		flushList();

		const key = keyMatch[1];
		const rest = keyMatch[2].trim();

		if (rest === '') {
			// Potential block list — start accumulation
			currentKey = key;
			listValues = [];
		} else if (rest.startsWith('[')) {
			// Inline list: [a, b, c]
			const inner = rest.slice(1, rest.lastIndexOf(']'));
			result[key] = inner
				.split(',')
				.map(s => s.trim().replace(/^['"]|['"]$/g, ''))
				.filter(Boolean);
		} else {
			// Scalar (strip optional surrounding quotes)
			result[key] = rest.replace(/^['"]|['"]$/g, '');
		}
	}
	flushList();

	return result;
}

/**
 * Scan all Markdown files under `contactsFolder` (recursively), parse their
 * `email:` frontmatter field, and return a Map<lowerCaseEmail, noteBaseName>.
 *
 * Returns an empty map when:
 *   - `contactsFolder` is empty / blank
 *   - the folder does not exist in the vault
 *   - no files have a valid `email:` field
 */
export async function buildContactMap(app: App, contactsFolder: string): Promise<ContactMap> {
	const map: ContactMap = new Map();
	const folder = contactsFolder.trim();
	if (!folder) return map;

	const files = collectMarkdownFiles(app, folder);

	for (const file of files) {
		try {
			const content = await app.vault.cachedRead(file);
			const fm = extractFrontmatter(content);
			const emails = parseEmailField(fm['email']);
			for (const email of emails) {
				map.set(email.toLowerCase(), file.basename);
			}
		} catch {
			// Skip unreadable files silently
		}
	}

	return map;
}
