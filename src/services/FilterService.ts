/**
 * FilterService — canonical event-filtering logic for Calendar Bridge.
 *
 * Used by:
 *   - PreviewSection (panel preview)
 *   - DiagnosticsService (sync report)
 *   - FilterService tests
 *
 * Rule: UI must not contain business logic. This module is the single
 * source of truth for "why is this event excluded?" logic.
 */

import { NormalizedEvent } from '../types';
import { FilterState } from '../views/panel/stores/FilterStore';

export interface FilterResult {
	/** Events that pass all filters. */
	included: NormalizedEvent[];
	/** Events excluded, with per-event reason. */
	excluded: Array<{ event: NormalizedEvent; reason: string }>;
	/** Aggregate exclusion counts keyed by reason string. */
	exclusionCounts: Record<string, number>;
}

/**
 * Apply panel filter state to a list of events.
 * Returns null if the event passes, or a human-readable reason if excluded.
 */
export function getExclusionReason(
	event: NormalizedEvent,
	filters: FilterState,
): string | null {
	if (!filters.panelIncludeAllDay && event.isAllDay) {
		return 'All-day excluded';
	}

	if (!filters.panelIncludeDeclined && event.attendees) {
		const selfDeclined = event.attendees.some(a => a.responseStatus === 'declined');
		if (selfDeclined) return 'Declined';
	}

	if (filters.panelOnlyWithAttendees && (!event.attendees || event.attendees.length === 0)) {
		return 'No attendees';
	}

	if (filters.panelSkipShorterThanMin > 0 && !event.isAllDay) {
		const durationMs = event.endDate.getTime() - event.startDate.getTime();
		const durationMin = durationMs / 60000;
		if (durationMin < filters.panelSkipShorterThanMin) {
			return `< ${filters.panelSkipShorterThanMin} min`;
		}
	}

	if (filters.panelExcludeTitles) {
		const keywords = filters.panelTitleRegexMode
			? [filters.panelExcludeTitles]
			: filters.panelExcludeTitles.split(',').map(k => k.trim()).filter(Boolean);
		for (const kw of keywords) {
			try {
				const re = filters.panelTitleRegexMode ? new RegExp(kw, 'i') : null;
				if (re ? re.test(event.title) : event.title.toLowerCase().includes(kw.toLowerCase())) {
					return `Excluded: "${kw}"`;
				}
			} catch {
				// Invalid regex — skip
			}
		}
	}

	if (filters.panelIncludeTitles) {
		const keywords = filters.panelTitleRegexMode
			? [filters.panelIncludeTitles]
			: filters.panelIncludeTitles.split(',').map(k => k.trim()).filter(Boolean);
		const matches = keywords.some(kw => {
			try {
				const re = filters.panelTitleRegexMode ? new RegExp(kw, 'i') : null;
				return re ? re.test(event.title) : event.title.toLowerCase().includes(kw.toLowerCase());
			} catch {
				return false;
			}
		});
		if (!matches) return 'Title not in include list';
	}

	return null;
}

/**
 * Apply panel filters to a list of events.
 * Returns structured result with included/excluded breakdown.
 */
export function applyFilters(events: NormalizedEvent[], filters: FilterState): FilterResult {
	const included: NormalizedEvent[] = [];
	const excluded: Array<{ event: NormalizedEvent; reason: string }> = [];
	const exclusionCounts: Record<string, number> = {};

	for (const event of events) {
		const reason = getExclusionReason(event, filters);
		if (reason === null) {
			included.push(event);
		} else {
			excluded.push({ event, reason });
			exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1;
		}
	}

	return { included, excluded, exclusionCounts };
}
