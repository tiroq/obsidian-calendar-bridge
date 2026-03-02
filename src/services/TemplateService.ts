/**
 * TemplateService — Slot-based injection v2.
 *
 * Slot contract:
 *   Template author marks injection points with {{CB_SLOT_NAME}} tokens.
 *   After injection, each slot is wrapped in idempotent block markers:
 *     <!-- CB:BEGIN CB_CONTEXT -->
 *     …content…
 *     <!-- CB:END CB_CONTEXT -->
 *
 * CB_FM is special: it maps to Obsidian YAML frontmatter and must always
 * appear at the very top of the file.  It is NOT wrapped in HTML comment
 * markers.  Instead it is rendered as:
 *     ---
 *     <yaml lines>
 *     ---
 * Idempotency for CB_FM is achieved by detecting and replacing the
 * frontmatter block at the top of the file (^---\n[\s\S]*?\n---\n?).
 *
 * On subsequent syncs the markers are found and content is replaced
 * without touching anything outside the markers (user's zone).
 *
 * Slots: CB_FM, CB_HEADER, CB_LINKS, CB_CONTEXT, CB_ACTIONS,
 *        CB_BODY, CB_DECISIONS, CB_DIAGNOSTICS, CB_FOOTER
 */

// ─── Slot definitions ──────────────────────────────────────────────────────

export const CB_SLOTS = [
	'CB_FM',
	'CB_HEADER',
	'CB_LINKS',
	'CB_CONTEXT',
	'CB_ACTIONS',
	'CB_BODY',
	'CB_DECISIONS',
	'CB_DIAGNOSTICS',
	'CB_FOOTER',
] as const;

export type CbSlot = typeof CB_SLOTS[number];

// ─── Marker helpers ────────────────────────────────────────────────────────

export function cbBegin(slot: CbSlot): string {
	return `<!-- CB:BEGIN ${slot} -->`;
}

export function cbEnd(slot: CbSlot): string {
	return `<!-- CB:END ${slot} -->`;
}

/**
 * Build the full wrapped block string for a slot.
 *
 * CB_FM is special: no HTML markers — rendered as a YAML frontmatter fence.
 * All other slots: wrapped with <!-- CB:BEGIN/END --> markers.
 */

/**
 * Strip an existing CB wrapper for `slot` from `body`, returning only the inner content.
 * This prevents double-wrapping when upstream accidentally passes already-wrapped content.
 */
function stripExistingCbWrapper(slot: CbSlot, body: string): string {
	const beginRe = new RegExp(`^\\s*<!--\\s*CB:BEGIN\\s+${slot}\\s*-->\\s*\\n?`, 'mg');
	const endRe   = new RegExp(`\\n?\\s*<!--\\s*CB:END\\s+${slot}\\s*-->\\s*$`, 'mg');
	const hasBegin = beginRe.test(body);
	const hasEnd   = endRe.test(body);
	if (!hasBegin && !hasEnd) return body;
	// Use global replace so ALL occurrences are stripped (handles nested/duplicate markers)
	return body
		.replace(new RegExp(`^\\s*<!--\\s*CB:BEGIN\\s+${slot}\\s*-->\\s*\\n?`, 'mg'), '')
		.replace(new RegExp(`\\n?\\s*<!--\\s*CB:END\\s+${slot}\\s*-->\\s*$`, 'mg'), '')
		.trim();
}
export function wrapSlot(slot: CbSlot, content: string): string {
	if (slot === 'CB_FM') {
		// Frontmatter must be a pure YAML fence — no HTML markers.
		return `---\n${content.trim()}\n---`;
	}
	// Strip any pre-existing wrapper for this slot so we never produce nested markers.
	const clean = stripExistingCbWrapper(slot, content);
	return `${cbBegin(slot)}\n${clean}\n${cbEnd(slot)}`;
}

// ─── Parse result ──────────────────────────────────────────────────────────

export interface SlotParseResult {
	/** Slots whose {{CB_…}} token was found in the template. */
	found: CbSlot[];
	/** Slots not present in the template. */
	missing: CbSlot[];
}

/**
 * Inspect a template string for `{{CB_SLOT_NAME}}` tokens.
 * Returns which slots are present and which are absent.
 */
export function parseSlots(template: string): SlotParseResult {
	const found: CbSlot[] = [];
	const missing: CbSlot[] = [];
	for (const slot of CB_SLOTS) {
		if (template.includes(`{{${slot}}}`)) {
			found.push(slot);
		} else {
			missing.push(slot);
		}
	}
	return { found, missing };
}

// ─── Inject options ────────────────────────────────────────────────────────

export interface InjectBlocksOptions {
	/**
	 * When true, a CB_DIAGNOSTICS block is appended even if the slot was
	 * not found in the template (always visible when debug is enabled).
	 */
	debugEnabled?: boolean;
}

// ─── Block injection ───────────────────────────────────────────────────────

/**
 * Inject slot content into a note.
 *
 * Two modes:
 *   1. Template token `{{CB_SLOT}}` present → replace token with wrapped block.
 *   2. Existing `<!-- CB:BEGIN CB_SLOT -->…<!-- CB:END CB_SLOT -->` present →
 *      replace the old block with new content (idempotent update).
 *
 * If neither is found and `debugEnabled` is set for CB_DIAGNOSTICS,
 * the diagnostics block is appended at the end.
 *
 * Content outside managed blocks is never modified.
 */
export function injectBlocks(
	content: string,
	blocks: Partial<Record<CbSlot, string>>,
	opts: InjectBlocksOptions = {},
): string {
	let result = content;

	for (const slot of CB_SLOTS) {
		const body = blocks[slot];
		if (body === undefined) continue;

		const wrapped = wrapSlot(slot, body);

		if (slot === 'CB_FM') {
			// CB_FM is frontmatter — no HTML markers.
			// Mode 1: template token {{CB_FM}} → replace with fenced YAML.
			// Mode 2: existing frontmatter at top → replace it in-place.
			const fmTokenPattern = new RegExp(`\\{\\{${slot}\\}\\}`, 'g');
			if (fmTokenPattern.test(result)) {
				// Replace token — ensure frontmatter ends up at top
				result = result.replace(new RegExp(`\\{\\{${slot}\\}\\}`, 'g'), wrapped);
			} else if (cbFmRe.test(result)) {
				// Replace existing YAML frontmatter block
				result = result.replace(cbFmRe, wrapped + '\n');
			}
			// Ensure frontmatter is always at the very top
			result = hoistFrontmatter(result);
			continue;
		}

		const tokenPattern = new RegExp(`\\{\\{${slot}\\}\\}`, 'g');
		const blockRe = cbBlockRe(slot);

		if (tokenPattern.test(result)) {
			// Mode 1: replace template token
			result = result.replace(new RegExp(`\\{\\{${slot}\\}\\}`, 'g'), wrapped);
		} else if (blockRe.test(result)) {
			// Mode 2: strip ALL existing CB blocks for this slot (handles nested/corrupted markers),
			// then re-inject the fresh wrapped block in place of the first match position.
			// We do this by stripping all markers, then appending the fresh block.
			// But to preserve placement (not move to end), use a greedy regex to find outer boundary.
			result = result.replace(cbBlockReGreedy(slot), wrapped);
		} else if (slot === 'CB_DIAGNOSTICS' && opts.debugEnabled) {
			// Special case: always append diagnostics when debug enabled
			result = result.trimEnd() + `\n\n${wrapped}\n`;
		}
		// Otherwise: slot not in template and not previously injected → skip
	}

	return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Regex matching the YAML frontmatter block at the top of a file. */
const cbFmRe = /^---\n[\s\S]*?\n---\n?/;

function cbBlockRe(slot: CbSlot): RegExp {
	return new RegExp(
		`<!--\\s*CB:BEGIN\\s+${slot}\\s*-->[\\s\\S]*?<!--\\s*CB:END\\s+${slot}\\s*-->`,
		'g',
	);
}

/** Greedy version of cbBlockRe — matches from the FIRST BEGIN to the LAST END for a slot.
 * Use in Mode 2 of injectBlocks to handle corrupted notes with nested/duplicate markers.
 */
function cbBlockReGreedy(slot: CbSlot): RegExp {
	return new RegExp(
		`<!--\\s*CB:BEGIN\\s+${slot}\\s*-->[\\s\\S]*<!--\\s*CB:END\\s+${slot}\\s*-->`,
		'g',
	);
}

/**
 * If a `---...---` frontmatter block exists but is not at position 0,
 * move it to the top.  Handles the edge case where a template has text
 * before {{CB_FM}} (which would be unusual but shouldn't crash).
 */
function hoistFrontmatter(content: string): string {
	// Already at top — most common case, fast exit
	if (content.startsWith('---\n')) return content;
	const match = content.match(/---\n[\s\S]*?\n---\n?/);
	if (!match || match.index === undefined) return content;
	const fm = match[0].endsWith('\n') ? match[0] : match[0] + '\n';
	const rest = content.slice(0, match.index) + content.slice(match.index + match[0].length);
	return fm + rest.replace(/^\n+/, '');
}

// ─── Extraction ───────────────────────────────────────────────────────────

/**
 * Extract the inner content of a named CB block from a note.
 * Returns `undefined` if the block is absent.
 */
export function extractSlotContent(note: string, slot: CbSlot): string | undefined {
	const re = new RegExp(
		`<!--\\s*CB:BEGIN\\s+${slot}\\s*-->([\\s\\S]*?)<!--\\s*CB:END\\s+${slot}\\s*-->`,
	);
	const m = note.match(re);
	if (!m) return undefined;
	return m[1].replace(/^\n/, '').replace(/\n$/, '');
}
