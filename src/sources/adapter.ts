/**
 * Abstract CalendarSourceAdapter interface and SeriesKey computation.
 * All source adapters normalize events to NormalizedEvent.
 */

import { NormalizedEvent, RichCalendarItem, SourceType } from '../types';

// ─── Adapter capabilities ──────────────────────────────────────────────────────

export interface SourceCapabilities {
	attendees: boolean;
	conference: boolean;
	incremental: boolean;
}

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface CalendarSourceAdapter {
	readonly id: string;
	readonly name: string;
	readonly sourceType: SourceType;
	readonly capabilities: SourceCapabilities;

	/** Test the connection and return a human-readable status string. */
	testConnection(): Promise<{ ok: boolean; message: string }>;

	/** List available calendars (id + name). */
	/** List available calendars with rich metadata (color, role, timezone). */
	listCalendars(): Promise<RichCalendarItem[]>;

	/** Fetch all events whose start falls in [timeMin, timeMax]. */
	listEvents(
		calendarId: string,
		timeMin: Date,
		timeMax: Date,
	): Promise<NormalizedEvent[]>;
}

// ─── SeriesKey computation ────────────────────────────────────────────────────

/**
 * Compute a stable, deterministic seriesKey for an event.
 *
 * Priority:
 *   1. Google recurringEventId → "gcal:<recurringEventId>"
 *   2. iCal UID                → "ical:<uid>"
 *   3. Fallback hash           → "single:<eventId>"
 *
 * Rule 3 means non-recurring events each get a unique key (no series grouping).
 */
export function computeSeriesKey(opts: {
	recurringEventId?: string;
	uid?: string;
	eventId: string;
	isRecurring: boolean;
}): string {
	if (opts.recurringEventId) {
		return `gcal:${opts.recurringEventId}`;
	}
	if (opts.uid && opts.isRecurring) {
		return `ical:${opts.uid}`;
	}
	return `single:${opts.eventId}`;
}
