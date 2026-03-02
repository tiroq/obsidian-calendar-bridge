/**
 * DecisionFilter — filters extracted decisions from CB_DECISIONS slots
 * based on staleness, embedded dates, and sticky annotations.
 *
 * Rules (in priority order):
 *   1. Contains stickyToken → INCLUDED (reason: sticky)
 *   2. dropExpiredByDate is true AND text has embedded date < today → EXCLUDED (reason: expired_by_date)
 *   3. (today - sourceDate).days > horizonDays → EXCLUDED (reason: ttl)
 *   4. Otherwise → INCLUDED (reason: within_horizon)
 */

import { parseEmbeddedDate } from '../utils/decisionDates';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractedDecision {
	/** The raw decision line text (may contain the stickyToken). */
	text: string;
	/** Vault path of the note this decision came from. */
	sourcePath: string;
	/** Parsed date of the note/event (from frontmatter, filename, or mtime). */
	sourceDate: Date;
}

export interface DecisionFilterOptions {
	/** Reference "now" (injectable for deterministic tests). */
	now: Date;
	/** Decisions older than this many days are excluded. Default: 14. */
	horizonDays: number;
	/** When true, decisions with a past embedded date are excluded. Default: true. */
	dropExpiredByDate: boolean;
	/** Token whose presence marks a decision as permanently sticky. Default: '!sticky'. */
	stickyToken: string;
	/** When true, per-decision reasons are included in the result. */
	debug?: boolean;
}

export interface DecisionFilterResult {
	/** Decisions that passed all filters (ready to render). */
	included: ExtractedDecision[];
	/** Decisions that were excluded, with reasons. */
	excluded: Array<{ decision: ExtractedDecision; reason: string }>;
	/**
	 * Summary counts:
	 *   sticky, within_horizon, expired_by_date, ttl, source_date_missing
	 */
	stats: Record<string, number>;
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Filter a list of extracted decisions according to the supplied options.
 * Modifies nothing — pure function.
 */
export function filterDecisions(
	decisions: ExtractedDecision[],
	opts: DecisionFilterOptions,
): DecisionFilterResult {
	const { now, horizonDays, dropExpiredByDate, stickyToken } = opts;

	const nowMidnight = midnight(now);

	const included: ExtractedDecision[] = [];
	const excluded: Array<{ decision: ExtractedDecision; reason: string }> = [];
	const stats: Record<string, number> = {
		sticky: 0,
		within_horizon: 0,
		expired_by_date: 0,
		ttl: 0,
		source_date_missing: 0,
	};

	for (const decision of decisions) {
		// Rule 1 — sticky override
		if (decision.text.includes(stickyToken)) {
			stats.sticky++;
			included.push(decision);
			continue;
		}

		// Rule 2 — expired by embedded date
		if (dropExpiredByDate) {
			const embedded = parseEmbeddedDate(decision.text);
			if (embedded !== null && embedded < nowMidnight) {
				stats.expired_by_date++;
				excluded.push({ decision, reason: 'expired_by_date' });
				continue;
			}
		}

		// Rule 3 — TTL by source note age
		const sourceMidnight = midnight(decision.sourceDate);
		const ageDays = diffDays(nowMidnight, sourceMidnight);

		if (ageDays > horizonDays) {
			stats.ttl++;
			excluded.push({ decision, reason: 'ttl' });
			continue;
		}

		// Rule 4 — within horizon
		stats.within_horizon++;
		included.push(decision);
	}

	return { included, excluded, stats };
}

/**
 * Strip the stickyToken from a decision text for display purposes.
 * Trims surrounding whitespace after removal.
 */
export function stripStickyToken(text: string, stickyToken: string): string {
	return text.replace(stickyToken, '').replace(/\s{2,}/g, ' ').trim();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function midnight(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Number of full days between two midnight-normalised dates. */
function diffDays(later: Date, earlier: Date): number {
	const msPerDay = 1000 * 60 * 60 * 24;
	return Math.floor((later.getTime() - earlier.getTime()) / msPerDay);
}
