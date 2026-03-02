/**
 * Tests for filterDecisions + stripStickyToken (src/services/DecisionFilter.ts)
 */
import {
	filterDecisions,
	stripStickyToken,
	ExtractedDecision,
	DecisionFilterOptions,
} from '../src/services/DecisionFilter';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDecision(
	text: string,
	sourcePath = 'Meetings/meeting.md',
	sourceDate = new Date('2026-02-20'),
): ExtractedDecision {
	return { text, sourcePath, sourceDate };
}

function makeOpts(overrides: Partial<DecisionFilterOptions> = {}): DecisionFilterOptions {
	return {
		now: new Date('2026-03-02'),
		horizonDays: 14,
		dropExpiredByDate: true,
		stickyToken: '!sticky',
		...overrides,
	};
}

// ─── filterDecisions ──────────────────────────────────────────────────────────

describe('filterDecisions', () => {
	describe('Rule 1 — sticky', () => {
		it('includes a decision containing stickyToken regardless of age', () => {
			// Source note is 60 days old — normally TTL'd
			const decision = makeDecision(
				'Freeze API interface !sticky',
				'Meetings/old.md',
				new Date('2026-01-01'),
			);
			const result = filterDecisions([decision], makeOpts());
			expect(result.included).toHaveLength(1);
			expect(result.excluded).toHaveLength(0);
			expect(result.stats.sticky).toBe(1);
		});

		it('includes a sticky decision even if embedded date is in the past', () => {
			const decision = makeDecision('Ship by 2020-01-01 !sticky');
			const result = filterDecisions([decision], makeOpts());
			expect(result.included).toHaveLength(1);
			expect(result.stats.sticky).toBe(1);
		});
	});

	describe('Rule 2 — expired by embedded date', () => {
		it('excludes a decision whose embedded date is in the past', () => {
			const decision = makeDecision('Ship by 2026-02-01'); // past relative to now=2026-03-02
			const result = filterDecisions([decision], makeOpts({ dropExpiredByDate: true }));
			expect(result.included).toHaveLength(0);
			expect(result.excluded).toHaveLength(1);
			expect(result.excluded[0].reason).toBe('expired_by_date');
			expect(result.stats.expired_by_date).toBe(1);
		});

		it('includes a decision whose embedded date is today', () => {
			// Date equals now → not strictly past → include
			const decision = makeDecision('Ship by 2026-03-02'); // exactly today
			const result = filterDecisions([decision], makeOpts({ dropExpiredByDate: true }));
			expect(result.included).toHaveLength(1);
		});

		it('includes a decision whose embedded date is in the future', () => {
			const decision = makeDecision('Ship by 2026-04-01');
			const result = filterDecisions([decision], makeOpts({ dropExpiredByDate: true }));
			expect(result.included).toHaveLength(1);
		});

		it('does not filter by embedded date when dropExpiredByDate is false', () => {
			// Past embedded date but dropExpiredByDate=false
			const decision = makeDecision(
				'Ship by 2020-01-01',
				'Meetings/note.md',
				new Date('2026-02-20'), // source date within horizon
			);
			const result = filterDecisions([decision], makeOpts({ dropExpiredByDate: false }));
			expect(result.included).toHaveLength(1);
		});

		it('includes a decision with no embedded date (falls through to TTL check)', () => {
			const decision = makeDecision(
				'Decide on API versioning strategy',
				'Meetings/note.md',
				new Date('2026-02-25'), // within 14-day horizon
			);
			const result = filterDecisions([decision], makeOpts());
			expect(result.included).toHaveLength(1);
			expect(result.stats.within_horizon).toBe(1);
		});
	});

	describe('Rule 3 — TTL by source note age', () => {
		it('excludes a decision from a note older than horizonDays', () => {
			const decision = makeDecision(
				'Consider new framework',
				'Meetings/old.md',
				new Date('2026-02-01'), // 29 days before 2026-03-02 → > 14 days
			);
			const result = filterDecisions([decision], makeOpts());
			expect(result.included).toHaveLength(0);
			expect(result.excluded[0].reason).toBe('ttl');
			expect(result.stats.ttl).toBe(1);
		});

		it('includes a decision from a note exactly horizonDays old', () => {
			// now=2026-03-02, horizonDays=14 → cutoff = 2026-02-16 (14 days ago)
			// source on 2026-02-16 → age = 14 days → NOT > 14 → included
			const decision = makeDecision(
				'Design review complete',
				'Meetings/note.md',
				new Date('2026-02-16'),
			);
			const result = filterDecisions([decision], makeOpts({ horizonDays: 14 }));
			expect(result.included).toHaveLength(1);
		});

		it('excludes a decision from a note that is horizonDays + 1 old', () => {
			const decision = makeDecision(
				'Design review complete',
				'Meetings/note.md',
				new Date('2026-02-15'), // 15 days ago > 14
			);
			const result = filterDecisions([decision], makeOpts({ horizonDays: 14 }));
			expect(result.excluded).toHaveLength(1);
			expect(result.excluded[0].reason).toBe('ttl');
		});
	});

	describe('Rule 4 — within horizon', () => {
		it('includes a recent decision with no embedded date', () => {
			const decision = makeDecision(
				'Use PostgreSQL for storage',
				'Meetings/note.md',
				new Date('2026-02-27'), // 3 days ago
			);
			const result = filterDecisions([decision], makeOpts());
			expect(result.included).toHaveLength(1);
			expect(result.stats.within_horizon).toBe(1);
		});
	});

	describe('mixed batch', () => {
		it('correctly categorises a batch of decisions', () => {
			const now = new Date('2026-03-02');
			const decisions = [
				// sticky — always included
				makeDecision('Keep TypeScript strict !sticky', 'Meetings/a.md', new Date('2026-01-01')),
				// expired by date
				makeDecision('Ship by 2026-01-15', 'Meetings/b.md', new Date('2026-02-20')),
				// TTL (source 30 days old)
				makeDecision('Use Redis for caching', 'Meetings/c.md', new Date('2026-01-31')),
				// within horizon (source 5 days old)
				makeDecision('Migrate to new API', 'Meetings/d.md', new Date('2026-02-25')),
			];

			const result = filterDecisions(decisions, makeOpts({ now }));
			expect(result.included).toHaveLength(2);  // sticky + within_horizon
			expect(result.excluded).toHaveLength(2);  // expired_by_date + ttl
			expect(result.stats.sticky).toBe(1);
			expect(result.stats.within_horizon).toBe(1);
			expect(result.stats.expired_by_date).toBe(1);
			expect(result.stats.ttl).toBe(1);
		});
	});

	describe('empty input', () => {
		it('returns empty results for empty input', () => {
			const result = filterDecisions([], makeOpts());
			expect(result.included).toHaveLength(0);
			expect(result.excluded).toHaveLength(0);
			expect(Object.values(result.stats).every(v => v === 0)).toBe(true);
		});
	});
});

// ─── stripStickyToken ─────────────────────────────────────────────────────────

describe('stripStickyToken', () => {
	it('removes the sticky token from text', () => {
		expect(stripStickyToken('Keep it !sticky', '!sticky')).toBe('Keep it');
	});

	it('trims surrounding whitespace after removal', () => {
		expect(stripStickyToken('!sticky Keep it', '!sticky')).toBe('Keep it');
	});

	it('collapses double spaces', () => {
		expect(stripStickyToken('Keep  it !sticky forever', '!sticky')).toBe('Keep it forever');
	});

	it('returns text unchanged when stickyToken is absent', () => {
		expect(stripStickyToken('Normal decision text', '!sticky')).toBe('Normal decision text');
	});

	it('works with a custom sticky token', () => {
		expect(stripStickyToken('Keep this [pin]', '[pin]')).toBe('Keep this');
	});
});
