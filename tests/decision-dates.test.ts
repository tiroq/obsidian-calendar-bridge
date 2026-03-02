/**
 * Tests for parseEmbeddedDate (src/utils/decisionDates.ts)
 */
import { parseEmbeddedDate } from '../src/utils/decisionDates';

describe('parseEmbeddedDate', () => {
	// ── ISO date ──────────────────────────────────────────────────────────────

	it('parses ISO date YYYY-MM-DD', () => {
		const d = parseEmbeddedDate('Ship the feature by 2026-03-06');
		expect(d).not.toBeNull();
		expect(d!.getFullYear()).toBe(2026);
		expect(d!.getMonth()).toBe(2);  // 0-indexed
		expect(d!.getDate()).toBe(6);
	});

	it('parses ISO datetime YYYY-MM-DDTHH:mm', () => {
		const d = parseEmbeddedDate('Meeting at 2026-03-06T14:30');
		expect(d).not.toBeNull();
		expect(d!.getFullYear()).toBe(2026);
		expect(d!.getMonth()).toBe(2);
		expect(d!.getDate()).toBe(6);
	});

	it('returns midnight-normalised date for ISO datetime', () => {
		const d = parseEmbeddedDate('2026-04-15T23:59');
		expect(d).not.toBeNull();
		expect(d!.getHours()).toBe(0);
		expect(d!.getMinutes()).toBe(0);
	});

	// ── English month-first ───────────────────────────────────────────────────

	it('parses "March 6, 2026"', () => {
		const d = parseEmbeddedDate('Deadline is March 6, 2026');
		expect(d).not.toBeNull();
		expect(d!.getFullYear()).toBe(2026);
		expect(d!.getMonth()).toBe(2);
		expect(d!.getDate()).toBe(6);
	});

	it('parses "Mar 6, 2026"', () => {
		const d = parseEmbeddedDate('Mar 6, 2026 is the target');
		expect(d).not.toBeNull();
		expect(d!.getMonth()).toBe(2);
		expect(d!.getDate()).toBe(6);
	});

	it('parses "March 6 2026" (no comma)', () => {
		const d = parseEmbeddedDate('March 6 2026 launch');
		expect(d).not.toBeNull();
		expect(d!.getDate()).toBe(6);
	});

	it('parses "January 1, 2026"', () => {
		const d = parseEmbeddedDate('Since January 1, 2026');
		expect(d).not.toBeNull();
		expect(d!.getMonth()).toBe(0);
		expect(d!.getDate()).toBe(1);
	});

	it('parses "December 31, 2025"', () => {
		const d = parseEmbeddedDate('Expires December 31, 2025');
		expect(d).not.toBeNull();
		expect(d!.getMonth()).toBe(11);
		expect(d!.getDate()).toBe(31);
	});

	// ── Day-first ─────────────────────────────────────────────────────────────

	it('parses "6 March 2026"', () => {
		const d = parseEmbeddedDate('6 March 2026 decision');
		expect(d).not.toBeNull();
		expect(d!.getMonth()).toBe(2);
		expect(d!.getDate()).toBe(6);
	});

	it('parses "6 Mar 2026"', () => {
		const d = parseEmbeddedDate('6 Mar 2026');
		expect(d).not.toBeNull();
		expect(d!.getDate()).toBe(6);
	});

	// ── Returns null ──────────────────────────────────────────────────────────

	it('returns null for plain text with no date', () => {
		expect(parseEmbeddedDate('Decide later about the architecture')).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(parseEmbeddedDate('')).toBeNull();
	});

	it('returns null for invalid ISO date "2026-13-01" (month 13)', () => {
		// Month 13 is invalid — should return null or be rejected
		const d = parseEmbeddedDate('2026-13-01');
		// Either null or a valid date — but specifically month 13 overflows
		// Our implementation clamps via Date constructor overflow detection
		expect(d).toBeNull();
	});

	it('returns null for invalid day "2026-02-30" (Feb 30)', () => {
		expect(parseEmbeddedDate('2026-02-30')).toBeNull();
	});

	it('returns null for a word that looks like a month but is not one', () => {
		expect(parseEmbeddedDate('Foobar 6, 2026')).toBeNull();
	});

	// ── ISO datetime preferred over ISO date ──────────────────────────────────

	it('prefers ISO datetime when both patterns present in text', () => {
		// "2026-03-06T14:30" comes before "2026-03-07" in the string
		const d = parseEmbeddedDate('Event 2026-03-06T14:30 ends 2026-03-07');
		expect(d).not.toBeNull();
		expect(d!.getDate()).toBe(6);
	});
});
