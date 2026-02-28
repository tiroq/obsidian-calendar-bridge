import { getExclusionReason, applyFilters, FilterResult } from '../src/services/FilterService';
import { NormalizedEvent } from '../src/types';
import { FilterState } from '../src/views/panel/stores/FilterStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
	const start = new Date('2026-03-01T10:00:00Z');
	const end = new Date('2026-03-01T11:00:00Z');
	return {
		source: 'gcal_api' as const,
		calendarId: 'cal-001',
		eventId: 'evt-001',
		uid: 'evt-001@google.com',
		title: 'Team Standup',
		start: start.toISOString(),
		end: end.toISOString(),
		startDate: start,
		endDate: end,
		isAllDay: false,
		status: 'confirmed',
		seriesKey: 'gcal:evt-001',
		isRecurring: false,
		sourceName: 'My Calendar',
		...overrides,
	};
}

function makeFilters(overrides: Partial<FilterState> = {}): FilterState {
	return {
		panelHorizonDays: 5,
		panelIncludeAllDay: true,
		panelIncludeDeclined: true,
		panelOnlyWithAttendees: false,
		panelSkipShorterThanMin: 0,
		panelExtractConferenceLinks: true,
		panelExtractAttendees: true,
		panelExtractLocation: true,
		panelExcludeTitles: '',
		panelIncludeTitles: '',
		panelTitleRegexMode: false,
		...overrides,
	};
}

// ─── getExclusionReason ────────────────────────────────────────────────────────

describe('getExclusionReason', () => {
	describe('all-day filter', () => {
		it('returns null for all-day event when include-all-day is on', () => {
			const event = makeEvent({ isAllDay: true });
			expect(getExclusionReason(event, makeFilters({ panelIncludeAllDay: true }))).toBeNull();
		});

		it('returns reason for all-day event when include-all-day is off', () => {
			const event = makeEvent({ isAllDay: true });
			expect(getExclusionReason(event, makeFilters({ panelIncludeAllDay: false }))).toBe('All-day excluded');
		});

		it('does not exclude non-all-day event even when include-all-day is off', () => {
			const event = makeEvent({ isAllDay: false });
			expect(getExclusionReason(event, makeFilters({ panelIncludeAllDay: false }))).toBeNull();
		});
	});

	describe('declined filter', () => {
		it('returns reason when self is declined and filter excludes declined', () => {
			const event = makeEvent({
				attendees: [{ email: 'me@example.com', responseStatus: 'declined' }],
			});
			expect(getExclusionReason(event, makeFilters({ panelIncludeDeclined: false }))).toBe('Declined');
		});

		it('returns null when self is declined but filter includes declined', () => {
			const event = makeEvent({
				attendees: [{ email: 'me@example.com', responseStatus: 'declined' }],
			});
			expect(getExclusionReason(event, makeFilters({ panelIncludeDeclined: true }))).toBeNull();
		});

		it('returns null when attendees have accepted and filter excludes declined', () => {
			const event = makeEvent({
				attendees: [{ email: 'me@example.com', responseStatus: 'accepted' }],
			});
			expect(getExclusionReason(event, makeFilters({ panelIncludeDeclined: false }))).toBeNull();
		});

		it('returns null when no attendees array and filter excludes declined', () => {
			const event = makeEvent({ attendees: undefined });
			expect(getExclusionReason(event, makeFilters({ panelIncludeDeclined: false }))).toBeNull();
		});
	});

	describe('only-with-attendees filter', () => {
		it('returns reason when event has no attendees and filter requires attendees', () => {
			const event = makeEvent({ attendees: [] });
			expect(getExclusionReason(event, makeFilters({ panelOnlyWithAttendees: true }))).toBe('No attendees');
		});

		it('returns reason when attendees is undefined and filter requires attendees', () => {
			const event = makeEvent({ attendees: undefined });
			expect(getExclusionReason(event, makeFilters({ panelOnlyWithAttendees: true }))).toBe('No attendees');
		});

		it('returns null when event has attendees and filter requires attendees', () => {
			const event = makeEvent({
				attendees: [{ email: 'other@example.com', responseStatus: 'accepted' }],
			});
			expect(getExclusionReason(event, makeFilters({ panelOnlyWithAttendees: true }))).toBeNull();
		});

		it('returns null when no attendees but filter does not require them', () => {
			const event = makeEvent({ attendees: [] });
			expect(getExclusionReason(event, makeFilters({ panelOnlyWithAttendees: false }))).toBeNull();
		});
	});

	describe('minimum duration filter', () => {
		it('returns reason when event is shorter than threshold', () => {
			// 30-min event, threshold 45
			const start = new Date('2026-03-01T10:00:00Z');
			const end = new Date('2026-03-01T10:30:00Z');
			const event = makeEvent({ startDate: start, endDate: end });
			expect(getExclusionReason(event, makeFilters({ panelSkipShorterThanMin: 45 }))).toBe('< 45 min');
		});

		it('returns null when event meets the threshold exactly', () => {
			const start = new Date('2026-03-01T10:00:00Z');
			const end = new Date('2026-03-01T10:45:00Z');
			const event = makeEvent({ startDate: start, endDate: end });
			expect(getExclusionReason(event, makeFilters({ panelSkipShorterThanMin: 45 }))).toBeNull();
		});

		it('returns null when threshold is 0 (disabled)', () => {
			const start = new Date('2026-03-01T10:00:00Z');
			const end = new Date('2026-03-01T10:05:00Z');
			const event = makeEvent({ startDate: start, endDate: end });
			expect(getExclusionReason(event, makeFilters({ panelSkipShorterThanMin: 0 }))).toBeNull();
		});

		it('does not apply to all-day events even when threshold is set', () => {
			const event = makeEvent({ isAllDay: true });
			expect(getExclusionReason(event, makeFilters({ panelSkipShorterThanMin: 60 }))).toBeNull();
		});
	});

	describe('exclude-titles filter', () => {
		it('excludes event whose title matches a keyword (case-insensitive)', () => {
			const event = makeEvent({ title: 'Brainstorm Session' });
			expect(getExclusionReason(event, makeFilters({ panelExcludeTitles: 'brainstorm' }))).toBe('Excluded: "brainstorm"');
		});

		it('excludes event matching any keyword in comma-separated list', () => {
			const event = makeEvent({ title: 'Weekly Review' });
			expect(getExclusionReason(event, makeFilters({ panelExcludeTitles: 'brainstorm, review' }))).toBe('Excluded: "review"');
		});

		it('returns null when title does not match any exclude keyword', () => {
			const event = makeEvent({ title: 'Team Standup' });
			expect(getExclusionReason(event, makeFilters({ panelExcludeTitles: 'brainstorm, review' }))).toBeNull();
		});

		it('excludes event matching exclude regex when regex mode enabled', () => {
			const event = makeEvent({ title: 'Sync Meeting 123' });
			expect(getExclusionReason(event, makeFilters({ panelExcludeTitles: '^Sync', panelTitleRegexMode: true }))).toBe('Excluded: "^Sync"');
		});

		it('skips invalid regex gracefully without throwing', () => {
			const event = makeEvent({ title: 'Standup' });
			expect(() =>
				getExclusionReason(event, makeFilters({ panelExcludeTitles: '[invalid', panelTitleRegexMode: true }))
			).not.toThrow();
		});
	});

	describe('include-titles filter', () => {
		it('excludes event whose title is not in include list', () => {
			const event = makeEvent({ title: 'Team Standup' });
			expect(getExclusionReason(event, makeFilters({ panelIncludeTitles: 'planning, retro' }))).toBe('Title not in include list');
		});

		it('returns null when title matches include keyword', () => {
			const event = makeEvent({ title: 'Sprint Planning' });
			expect(getExclusionReason(event, makeFilters({ panelIncludeTitles: 'planning' }))).toBeNull();
		});

		it('returns null when include-titles is empty (no filter)', () => {
			const event = makeEvent({ title: 'Anything' });
			expect(getExclusionReason(event, makeFilters({ panelIncludeTitles: '' }))).toBeNull();
		});

		it('includes event matching include regex when regex mode enabled', () => {
			const event = makeEvent({ title: 'Sprint Planning' });
			expect(getExclusionReason(event, makeFilters({ panelIncludeTitles: '^Sprint', panelTitleRegexMode: true }))).toBeNull();
		});
	});

	describe('combined filters', () => {
		it('all-day check fires before declined check', () => {
			// Both conditions true; should return all-day reason (first check)
			const event = makeEvent({
				isAllDay: true,
				attendees: [{ email: 'me@example.com', responseStatus: 'declined' }],
			});
			const filters = makeFilters({ panelIncludeAllDay: false, panelIncludeDeclined: false });
			expect(getExclusionReason(event, filters)).toBe('All-day excluded');
		});

		it('passes event that satisfies all filters', () => {
			const start = new Date('2026-03-01T10:00:00Z');
			const end = new Date('2026-03-01T11:00:00Z');
			const event = makeEvent({
				startDate: start,
				endDate: end,
				attendees: [{ email: 'other@example.com', responseStatus: 'accepted' }],
				title: 'Sprint Planning',
			});
			const filters = makeFilters({
				panelIncludeAllDay: false,
				panelIncludeDeclined: false,
				panelOnlyWithAttendees: true,
				panelSkipShorterThanMin: 30,
				panelIncludeTitles: 'planning',
			});
			expect(getExclusionReason(event, filters)).toBeNull();
		});
	});
});

// ─── applyFilters ──────────────────────────────────────────────────────────────

describe('applyFilters', () => {
	it('returns all events as included when no filters active', () => {
		const events = [makeEvent({ eventId: '1' }), makeEvent({ eventId: '2' })];
		const result = applyFilters(events, makeFilters());
		expect(result.included).toHaveLength(2);
		expect(result.excluded).toHaveLength(0);
		expect(result.exclusionCounts).toEqual({});
	});

	it('separates included and excluded events', () => {
		const included = makeEvent({ eventId: 'inc', isAllDay: false });
		const excluded = makeEvent({ eventId: 'exc', isAllDay: true });
		const result = applyFilters([included, excluded], makeFilters({ panelIncludeAllDay: false }));

		expect(result.included).toHaveLength(1);
		expect(result.included[0].eventId).toBe('inc');

		expect(result.excluded).toHaveLength(1);
		expect(result.excluded[0].event.eventId).toBe('exc');
		expect(result.excluded[0].reason).toBe('All-day excluded');
	});

	it('aggregates exclusion counts by reason', () => {
		const events = [
			makeEvent({ eventId: '1', isAllDay: true }),
			makeEvent({ eventId: '2', isAllDay: true }),
			makeEvent({ eventId: '3', attendees: [{ email: 'me@x.com', responseStatus: 'declined' }] }),
		];
		const result = applyFilters(events, makeFilters({ panelIncludeAllDay: false, panelIncludeDeclined: false }));

		expect(result.exclusionCounts['All-day excluded']).toBe(2);
		expect(result.exclusionCounts['Declined']).toBe(1);
		expect(result.included).toHaveLength(0);
	});

	it('handles empty event list', () => {
		const result = applyFilters([], makeFilters());
		expect(result.included).toHaveLength(0);
		expect(result.excluded).toHaveLength(0);
		expect(result.exclusionCounts).toEqual({});
	});

	it('returns correct FilterResult shape', () => {
		const result: FilterResult = applyFilters([makeEvent()], makeFilters());
		expect(result).toHaveProperty('included');
		expect(result).toHaveProperty('excluded');
		expect(result).toHaveProperty('exclusionCounts');
	});
});
