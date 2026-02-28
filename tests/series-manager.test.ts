import {
	groupBySeries,
	groupBySeriesNormalized,
	computePrevNext,
	generateSeriesAutogen,
	generateSeriesAutogenNormalized,
	generateSeriesPageContent,
	generateSeriesPageNormalized,
	getSeriesPath,
	getSeriesPagePathByKey,
	wrapAutogen,
	SeriesInfo,
	SeriesInfoNormalized,
} from '../src/series-manager';
import { sanitizeFilename } from '../src/note-generator';
import { CalendarEvent, NormalizedEvent, SeriesProfile } from '../src/types';
import { AUTOGEN_START, AUTOGEN_END } from '../src/note-generator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date('2024-01-15T12:00:00Z');

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
	return {
		source:      'ics_public',
		calendarId:  'cal1',
		eventId:     'evt-001',
		uid:         'evt-001',
		title:       'Test Meeting',
		start:       '2024-01-15T09:00:00Z',
		end:         '2024-01-15T10:00:00Z',
		startDate:   new Date('2024-01-15T09:00:00Z'),
		endDate:     new Date('2024-01-15T10:00:00Z'),
		isAllDay:    false,
		status:      'confirmed',
		seriesKey:   'ical:test-001',
		isRecurring: false,
		sourceName:  'Test Calendar',
		...overrides,
	};
}

function makeLegacyEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
	return {
		uid:         'standup-001',
		title:       'Daily Standup',
		description: '',
		location:    '',
		startDate:   new Date('2024-01-15T09:00:00Z'),
		endDate:     new Date('2024-01-15T09:15:00Z'),
		isAllDay:    false,
		isRecurring: true,
		attendees:   [],
		sourceId:    'src1',
		sourceName:  'Work',
		...overrides,
	};
}

function makeRecurring(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
	return makeEvent({
		isRecurring: true,
		seriesKey:   'ical:standup-001',
		title:       'Daily Standup',
		...overrides,
	});
}

// ─── getSeriesPath ────────────────────────────────────────────────────────────

describe('getSeriesPath', () => {
	it('uses seriesFolder setting when provided', () => {
		const path = getSeriesPath('Daily Standup', { seriesFolder: 'Meetings/Series' });
		expect(path).toBe('Meetings/Series/Daily Standup.md');
	});

	it('falls back to seriesRoot when seriesFolder is absent', () => {
		const path = getSeriesPath('Weekly Review', { seriesRoot: 'Archive/Series' });
		expect(path).toBe('Archive/Series/Weekly Review.md');
	});

	it('uses default root when both are absent', () => {
		const path = getSeriesPath('My Meeting', {});
		expect(path).toBe('Meetings/_series/My Meeting.md');
	});

	it('sanitizes special characters in the title', () => {
		const path = getSeriesPath('A/B: Review?', { seriesFolder: 'S' });
		expect(path).not.toContain('/B');
		expect(path).not.toContain('?');
		expect(path).not.toContain(':');
	});
});

// ─── Navigation path consistency ────────────────────────────────────────────

describe('series navigation — creation and navigation paths must match', () => {
	it('sanitizeFilename(seriesName) matches the filename used by getSeriesPath', () => {
		// This verifies that openSeriesPageForNote (navigation) computes the same
		// path as getSeriesPath (creation). If these diverge, navigation breaks.
		const titles = [
			'Team Standup',
			'A/B: Review?',
			'Weekly 1:1 — Engineering',
			'gcal:abc123',          // edge case: key-like title
		];
		const seriesFolder = 'Meetings/Series';
		for (const title of titles) {
			const creationPath = getSeriesPath(title, { seriesFolder });
			const navPath = `${seriesFolder}/${sanitizeFilename(title)}.md`;
			expect(navPath).toBe(creationPath);
		}
	});
});

// ─── getSeriesPagePathByKey ───────────────────────────────────────────────────

describe('getSeriesPagePathByKey', () => {
	it('slugifies the series name', () => {
		const path = getSeriesPagePathByKey('Daily Standup', { seriesFolder: 'S' });
		expect(path).toBe('S/daily-standup.md');
	});

	it('uses seriesRoot fallback', () => {
		const path = getSeriesPagePathByKey('Weekly Review', { seriesRoot: 'Root' });
		expect(path).toBe('Root/weekly-review.md');
	});

	it('uses default root when settings are empty', () => {
		const path = getSeriesPagePathByKey('TA Standup / weekly', {});
		expect(path).toBe('Meetings/_series/ta-standup-weekly.md');
	});
});

// ─── groupBySeries (legacy CalendarEvent) ────────────────────────────────────

describe('groupBySeries', () => {
	it('returns empty map for empty input', () => {
		expect(groupBySeries([])).toEqual(new Map());
	});

	it('ignores non-recurring events', () => {
		const event = makeLegacyEvent({ isRecurring: false });
		expect(groupBySeries([event]).size).toBe(0);
	});

	it('groups recurring events by UID', () => {
		const e1 = makeLegacyEvent({ uid: 'standup-001', startDate: new Date('2024-01-15T09:00:00Z') });
		const e2 = makeLegacyEvent({ uid: 'standup-001', startDate: new Date('2024-01-16T09:00:00Z') });
		const groups = groupBySeries([e1, e2]);
		expect(groups.size).toBe(1);
		expect(groups.get('standup-001')?.instances).toHaveLength(2);
	});

	it('sorts instances by startDate ascending', () => {
		const later  = makeLegacyEvent({ uid: 'x', startDate: new Date('2024-01-17T09:00:00Z') });
		const earlier = makeLegacyEvent({ uid: 'x', startDate: new Date('2024-01-15T09:00:00Z') });
		const groups = groupBySeries([later, earlier]);
		const instances = groups.get('x')!.instances;
		expect(instances[0].startDate.getTime()).toBeLessThan(instances[1].startDate.getTime());
	});

	it('creates separate groups for different UIDs', () => {
		const a = makeLegacyEvent({ uid: 'aaa' });
		const b = makeLegacyEvent({ uid: 'bbb' });
		expect(groupBySeries([a, b]).size).toBe(2);
	});

	it('captures series title and sourceName from first event', () => {
		const e = makeLegacyEvent({ uid: 'x', title: 'My Series', sourceName: 'My Cal' });
		const group = groupBySeries([e]).get('x')!;
		expect(group.title).toBe('My Series');
		expect(group.sourceName).toBe('My Cal');
	});
});

// ─── groupBySeriesNormalized ──────────────────────────────────────────────────

describe('groupBySeriesNormalized', () => {
	it('returns empty map for empty input', () => {
		expect(groupBySeriesNormalized([])).toEqual(new Map());
	});

	it('ignores non-recurring events', () => {
		const event = makeEvent({ isRecurring: false });
		expect(groupBySeriesNormalized([event]).size).toBe(0);
	});

	it('groups by seriesKey', () => {
		const e1 = makeRecurring({ eventId: 'e1', startDate: new Date('2024-01-15T09:00:00Z') });
		const e2 = makeRecurring({ eventId: 'e2', startDate: new Date('2024-01-16T09:00:00Z') });
		const groups = groupBySeriesNormalized([e1, e2]);
		expect(groups.size).toBe(1);
		expect(groups.get('ical:standup-001')?.instances).toHaveLength(2);
	});

	it('keeps separate groups for different seriesKeys', () => {
		const a = makeRecurring({ eventId: 'a', seriesKey: 'ical:aaa' });
		const b = makeRecurring({ eventId: 'b', seriesKey: 'ical:bbb' });
		expect(groupBySeriesNormalized([a, b]).size).toBe(2);
	});

	it('sorts instances ascending by startDate', () => {
		const later  = makeRecurring({ eventId: 'l', startDate: new Date('2024-01-17T09:00:00Z') });
		const earlier = makeRecurring({ eventId: 'e', startDate: new Date('2024-01-15T09:00:00Z') });
		const instances = groupBySeriesNormalized([later, earlier])
			.get('ical:standup-001')!.instances;
		expect(instances[0].startDate.getTime()).toBeLessThan(instances[1].startDate.getTime());
	});
});

// ─── computePrevNext ─────────────────────────────────────────────────────────

describe('computePrevNext', () => {
	const e1 = makeRecurring({ eventId: 'e1', startDate: new Date('2024-01-15T09:00:00Z') });
	const e2 = makeRecurring({ eventId: 'e2', startDate: new Date('2024-01-16T09:00:00Z') });
	const e3 = makeRecurring({ eventId: 'e3', startDate: new Date('2024-01-17T09:00:00Z') });
	const series: SeriesInfoNormalized = {
		seriesKey: 'ical:standup-001',
		seriesName: 'Daily Standup',
		sourceName: 'Work',
		instances: [e1, e2, e3],
	};
	const pathFn = (e: NormalizedEvent) => `Meetings/${e.eventId}.md`;

	it('returns undefined prevPath for the first event', () => {
		const { prevPath } = computePrevNext(e1, series, pathFn);
		expect(prevPath).toBeUndefined();
	});

	it('returns the correct nextPath for the first event', () => {
		const { nextPath } = computePrevNext(e1, series, pathFn);
		expect(nextPath).toBe('Meetings/e2.md');
	});

	it('returns both prev and next for a middle event', () => {
		const { prevPath, nextPath } = computePrevNext(e2, series, pathFn);
		expect(prevPath).toBe('Meetings/e1.md');
		expect(nextPath).toBe('Meetings/e3.md');
	});

	it('returns undefined nextPath for the last event', () => {
		const { nextPath } = computePrevNext(e3, series, pathFn);
		expect(nextPath).toBeUndefined();
	});

	it('returns both undefined when eventId is not found in series', () => {
		const unknown = makeRecurring({ eventId: 'unknown' });
		const { prevPath, nextPath } = computePrevNext(unknown, series, pathFn);
		expect(prevPath).toBeUndefined();
		expect(nextPath).toBeUndefined();
	});
});

// ─── generateSeriesAutogen (legacy) ──────────────────────────────────────────

describe('generateSeriesAutogen', () => {
	const pathFn = (e: CalendarEvent) => `Meetings/${e.uid}.md`;

	it('returns empty string for a series with no instances', () => {
		const series: SeriesInfo = {
			uid: 'x', title: 'X', sourceName: 'C', instances: [],
		};
		expect(generateSeriesAutogen(series, pathFn, NOW)).toBe('');
	});

	it('puts future events under Upcoming Meetings', () => {
		const series: SeriesInfo = {
			uid: 'standup',
			title: 'Standup',
			sourceName: 'Work',
			instances: [
				makeLegacyEvent({ uid: 'standup', startDate: new Date('2024-01-20T09:00:00Z') }),
			],
		};
		const result = generateSeriesAutogen(series, pathFn, NOW);
		expect(result).toContain('## Upcoming Meetings');
		expect(result).not.toContain('## Past Meetings');
	});

	it('puts past events under Past Meetings', () => {
		const series: SeriesInfo = {
			uid: 'standup',
			title: 'Standup',
			sourceName: 'Work',
			instances: [
				makeLegacyEvent({ uid: 'standup', startDate: new Date('2024-01-10T09:00:00Z') }),
			],
		};
		const result = generateSeriesAutogen(series, pathFn, NOW);
		expect(result).toContain('## Past Meetings');
		expect(result).not.toContain('## Upcoming Meetings');
	});

	it('renders wikilinks using the notePathFn', () => {
		const series: SeriesInfo = {
			uid: 'standup',
			title: 'Standup',
			sourceName: 'Work',
			instances: [
				makeLegacyEvent({ uid: 'standup', startDate: new Date('2024-01-20T09:00:00Z') }),
			],
		};
		const result = generateSeriesAutogen(series, pathFn, NOW);
		expect(result).toContain('[[standup]]');
	});
});

// ─── generateSeriesAutogenNormalized ─────────────────────────────────────────

describe('generateSeriesAutogenNormalized', () => {
	const pathFn = (e: NormalizedEvent) => `Meetings/${e.eventId}.md`;

	it('returns empty string for a series with no instances', () => {
		const series: SeriesInfoNormalized = {
			seriesKey: 'k', seriesName: 'K', sourceName: 'C', instances: [],
		};
		expect(generateSeriesAutogenNormalized(series, pathFn, NOW)).toBe('');
	});

	it('puts future events under ## Upcoming', () => {
		const future = makeRecurring({ eventId: 'f1', startDate: new Date('2024-02-01T09:00:00Z') });
		const series: SeriesInfoNormalized = {
			seriesKey: 'ical:standup-001', seriesName: 'Standup', sourceName: 'W',
			instances: [future],
		};
		const result = generateSeriesAutogenNormalized(series, pathFn, NOW);
		expect(result).toContain('## Upcoming');
	});

	it('puts past events under ## Past', () => {
		const past = makeRecurring({ eventId: 'p1', startDate: new Date('2024-01-01T09:00:00Z') });
		const series: SeriesInfoNormalized = {
			seriesKey: 'ical:standup-001', seriesName: 'Standup', sourceName: 'W',
			instances: [past],
		};
		const result = generateSeriesAutogenNormalized(series, pathFn, NOW);
		expect(result).toContain('## Past');
	});

	it('renders cancelled events with strikethrough', () => {
		const cancelled = makeRecurring({
			eventId: 'c1',
			status: 'cancelled',
			startDate: new Date('2024-02-01T09:00:00Z'),
		});
		const series: SeriesInfoNormalized = {
			seriesKey: 'ical:standup-001', seriesName: 'Standup', sourceName: 'W',
			instances: [cancelled],
		};
		const result = generateSeriesAutogenNormalized(series, pathFn, NOW);
		expect(result).toContain('~~');
	});

	it('groups events by month with month headings', () => {
		const jan = makeRecurring({ eventId: 'j', startDate: new Date('2024-02-10T09:00:00Z') });
		const feb = makeRecurring({ eventId: 'f', startDate: new Date('2024-03-10T09:00:00Z') });
		const series: SeriesInfoNormalized = {
			seriesKey: 'ical:standup-001', seriesName: 'Standup', sourceName: 'W',
			instances: [jan, feb],
		};
		const result = generateSeriesAutogenNormalized(series, pathFn, NOW);
		expect(result).toContain('###');
	});
});

// ─── wrapAutogen ─────────────────────────────────────────────────────────────

describe('wrapAutogen', () => {
	it('wraps body with AUTOGEN_START and AUTOGEN_END', () => {
		const result = wrapAutogen('body content');
		expect(result).toContain(AUTOGEN_START);
		expect(result).toContain(AUTOGEN_END);
		expect(result).toContain('body content');
	});

	it('preserves empty body', () => {
		const result = wrapAutogen('');
		expect(result.startsWith(AUTOGEN_START)).toBe(true);
		expect(result.endsWith(AUTOGEN_END)).toBe(true);
	});
});

// ─── generateSeriesPageContent (legacy) ──────────────────────────────────────

describe('generateSeriesPageContent', () => {
	const series: SeriesInfo = {
		uid:        'standup-001',
		title:      'Daily Standup',
		sourceName: 'Work',
		instances:  [
			makeLegacyEvent({ uid: 'standup-001', startDate: new Date('2024-01-20T09:00:00Z') }),
		],
	};
	const pathFn = (e: CalendarEvent) => `Meetings/${e.uid}.md`;

	it('includes the series title as H1', () => {
		const content = generateSeriesPageContent(series, pathFn, NOW);
		expect(content).toContain('# Daily Standup');
	});

	it('includes the calendar name', () => {
		const content = generateSeriesPageContent(series, pathFn, NOW);
		expect(content).toContain('Work');
	});

	it('includes AUTOGEN start/end markers', () => {
		const content = generateSeriesPageContent(series, pathFn, NOW);
		expect(content).toContain(AUTOGEN_START);
		expect(content).toContain(AUTOGEN_END);
	});

	it('includes a Notes section placeholder', () => {
		const content = generateSeriesPageContent(series, pathFn, NOW);
		expect(content).toContain('## Notes');
	});
});

// ─── generateSeriesPageNormalized ─────────────────────────────────────────────

describe('generateSeriesPageNormalized', () => {
	const series: SeriesInfoNormalized = {
		seriesKey:  'ical:standup-001',
		seriesName: 'Daily Standup',
		sourceName: 'Work',
		instances:  [
			makeRecurring({ eventId: 'e1', startDate: new Date('2024-01-20T09:00:00Z') }),
		],
	};
	const pathFn = (e: NormalizedEvent) => `Meetings/${e.eventId}.md`;

	it('includes YAML frontmatter with type and series_key', () => {
		const content = generateSeriesPageNormalized(series, pathFn, undefined, NOW);
		expect(content).toContain('type: meeting_series');
		expect(content).toContain('series_key: ical:standup-001');
	});

	it('includes the series title as H1', () => {
		const content = generateSeriesPageNormalized(series, pathFn, undefined, NOW);
		expect(content).toContain('# Daily Standup');
	});

	it('includes the series slug', () => {
		const content = generateSeriesPageNormalized(series, pathFn, undefined, NOW);
		expect(content).toContain('daily-standup');
	});

	it('includes AUTOGEN markers', () => {
		const content = generateSeriesPageNormalized(series, pathFn, undefined, NOW);
		expect(content).toContain(AUTOGEN_START);
		expect(content).toContain(AUTOGEN_END);
	});

	it('includes profile tags in frontmatter when profile provides them', () => {
		const profile: SeriesProfile = {
			seriesKey:  'ical:standup-001',
			seriesName: 'Daily Standup',
			enabled:    true,
			tags:       ['work', 'engineering'],
		};
		const content = generateSeriesPageNormalized(series, pathFn, profile, NOW);
		expect(content).toContain('tags: [work, engineering]');
	});

	it('does not include tags line when profile has no tags', () => {
		const content = generateSeriesPageNormalized(series, pathFn, undefined, NOW);
		expect(content).not.toMatch(/^tags:/m);
	});
});
