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

/** Build the full wrapped block string for a slot. */
export function wrapSlot(slot: CbSlot, content: string): string {
	return `${cbBegin(slot)}\n${content}\n${cbEnd(slot)}`;
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
		const tokenPattern = new RegExp(`\\{\\{${slot}\\}\\}`, 'g');
		const blockRe = cbBlockRe(slot);

		if (tokenPattern.test(result)) {
			// Mode 1: replace template token
			result = result.replace(new RegExp(`\\{\\{${slot}\\}\\}`, 'g'), wrapped);
		} else if (blockRe.test(result)) {
			// Mode 2: replace existing CB block (idempotent)
			result = result.replace(cbBlockRe(slot), wrapped);
		} else if (slot === 'CB_DIAGNOSTICS' && opts.debugEnabled) {
			// Special case: always append diagnostics when debug enabled
			result = result.trimEnd() + `\n\n${wrapped}\n`;
		}
		// Otherwise: slot not in template and not previously injected → skip
	}

	return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function cbBlockRe(slot: CbSlot): RegExp {
	return new RegExp(
		`<!--\\s*CB:BEGIN\\s+${slot}\\s*-->[\\s\\S]*?<!--\\s*CB:END\\s+${slot}\\s*-->`,
		'g',
	);
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
