import {
	DEFAULT_TEMPLATE,
	AUTOGEN_END,
	AUTOGEN_START,
	AUTOGEN_AGENDA_START,
	AUTOGEN_AGENDA_END,
	AUTOGEN_JOINERS_START,
	AUTOGEN_LINKS_START,
	fillTemplate,
	fillTemplateNormalized,
	formatDate,
	formatDuration,
	getNotePath,
	getNotePaths,
	getSeriesPagePath,
	sanitizeFilename,
	slugify,
	updateAutogenBlocks,
	updateAutogenBlocksNamed,
	buildFrontmatter,
	buildAgendaBlock,
	buildJoinersBlock,
	buildLinksBlock,
} from '../src/note-generator';
import { CalendarEvent, DEFAULT_SETTINGS, NormalizedEvent, PluginSettings, SeriesProfile } from '../src/types';

// ─── formatDate ───────────────────────────────────────────────────────────────

describe('formatDate', () => {
	const d = new Date(2024, 0, 15, 9, 5, 3); // 2024-01-15 09:05:03 local

	it('formats YYYY-MM-DD', () => {
		expect(formatDate(d, 'YYYY-MM-DD')).toBe('2024-01-15');
	});

	it('formats HH:mm', () => {
		expect(formatDate(d, 'HH:mm')).toBe('09:05');
	});

	it('formats DD/MM/YYYY', () => {
		expect(formatDate(d, 'DD/MM/YYYY')).toBe('15/01/2024');
	});
});

// ─── formatDuration ───────────────────────────────────────────────────────────

describe('formatDuration', () => {
	const base = new Date('2024-01-15T09:00:00Z');

	it('formats minutes', () => {
		expect(formatDuration(base, new Date('2024-01-15T09:30:00Z'))).toBe('30m');
	});

	it('formats whole hours', () => {
		expect(formatDuration(base, new Date('2024-01-15T11:00:00Z'))).toBe('2h');
	});

	it('formats hours and minutes', () => {
		expect(formatDuration(base, new Date('2024-01-15T10:45:00Z'))).toBe('1h 45m');
	});

	it('returns 0m for zero duration', () => {
		expect(formatDuration(base, base)).toBe('0m');
	});
});

// ─── sanitizeFilename ─────────────────────────────────────────────────────────

describe('sanitizeFilename', () => {
	it('removes path-separator characters', () => {
		expect(sanitizeFilename('A/B\\C')).toBe('ABC');
	});

	it('removes disallowed punctuation', () => {
		expect(sanitizeFilename('Hello: World? * < > |')).toBe('Hello World');
	});

	it('collapses multiple spaces', () => {
		expect(sanitizeFilename('A  B   C')).toBe('A B C');
	});

	it('trims leading and trailing whitespace', () => {
		expect(sanitizeFilename('  hello  ')).toBe('hello');
	});

	it('truncates to 200 characters', () => {
		const long = 'a'.repeat(300);
		expect(sanitizeFilename(long).length).toBe(200);
	});
});

// ─── getNotePath ──────────────────────────────────────────────────────────────

describe('getNotePath', () => {
	const settings = { ...DEFAULT_SETTINGS, meetingsRoot: undefined as unknown as string, notesFolder: 'Meetings', dateFormat: 'YYYY-MM-DD' };

	const event: CalendarEvent = {
		uid: 'test-001',
		title: 'Team Standup',
		description: '',
		location: '',
		startDate: new Date(2024, 0, 15, 9, 0, 0),
		endDate: new Date(2024, 0, 15, 9, 30, 0),
		isAllDay: false,
		isRecurring: false,
		attendees: [],
		sourceId: 'src1',
		sourceName: 'Work',
	};

	it('combines folder, date, and title', () => {
		expect(getNotePath(event, settings)).toBe('Meetings/2024-01-15 Team Standup.md');
	});

	it('sanitizes special characters in title', () => {
		const e = { ...event, title: 'Project: Update / Review' };
		const path = getNotePath(e, settings);
		expect(path).not.toContain('/Review');
		expect(path).not.toContain(':');
	});
});

// ─── getNotePaths ────────────────────────────────────────────────────────────────────

describe('getNotePaths', () => {
	const settings = { meetingsRoot: 'Meetings', dateFolderFormat: 'YYYY-MM-DD' };
	const START_ISO = '2026-03-01T13:00:00.000Z';

	/** Helper: build a minimal event compatible with getNotePaths. */
	function makeEvent(id: string, title: string, hour = 13): { title: string; startDate: Date; eventId: string; start: string } {
		const startDate = new Date(2026, 2, 1, hour, 0, 0); // 2026-03-01
		return { title, startDate, eventId: id, start: startDate.toISOString() };
	}

	/** Composite instance key used as map key in getNotePaths. */
	function key(id: string, start: string): string {
		return `${id}::${start}`;
	}

	it('no conflicts — returns base paths unchanged', () => {
		const a = makeEvent('id-aaa', 'Invoice Review');
		const b = makeEvent('id-bbb', 'Budget Meeting');
		const map = getNotePaths([a, b], settings);
		expect(map.get(key('id-aaa', a.start))).toBe('Meetings/2026-03-01/1300 Invoice Review.md');
		expect(map.get(key('id-bbb', b.start))).toBe('Meetings/2026-03-01/1300 Budget Meeting.md');
	});

	it('single event — no suffix', () => {
		const e = makeEvent('id-zzz', 'Standup');
		const map = getNotePaths([e], settings);
		expect(map.get(key('id-zzz', e.start))).toBe('Meetings/2026-03-01/1300 Standup.md');
	});

	it('conflict — both events get shortId suffix', () => {
		// Use IDs whose last-8-alphanumeric are predictable and distinct
		// 'eventAAA00000001' stripped → 'eventAAA00000001', last 8 = '00000001'
		// 'eventBBB00000002' stripped → 'eventBBB00000002', last 8 = '00000002'
		const a = makeEvent('eventAAA00000001', 'Invoice');
		const b = makeEvent('eventBBB00000002', 'Invoice');
		const map = getNotePaths([a, b], settings);
		const pathA = map.get(key('eventAAA00000001', a.start))!;
		const pathB = map.get(key('eventBBB00000002', b.start))!;
		// Both should contain the suffix pattern
		expect(pathA).toMatch(/1300 Invoice \([a-zA-Z0-9]+\)\.md$/);
		expect(pathB).toMatch(/1300 Invoice \([a-zA-Z0-9]+\)\.md$/);
		// Paths must be different from each other
		expect(pathA).not.toBe(pathB);
		// Short IDs match the last 8 alphanumeric chars of the eventId
		expect(pathA).toContain('00000001');
		expect(pathB).toContain('00000002');
	});

	it('conflict — non-conflicting event on same day is left clean', () => {
		const a = makeEvent('gcal:aaaaaa1111', 'Invoice');
		const b = makeEvent('gcal:bbbbbb2222', 'Invoice');
		const c = makeEvent('gcal:cccccc3333', 'Budget');
		const map = getNotePaths([a, b, c], settings);
		expect(map.get(key('gcal:cccccc3333', c.start))).toBe('Meetings/2026-03-01/1300 Budget.md');
		expect(map.get(key('gcal:aaaaaa1111', a.start))).toMatch(/1300 Invoice \([a-zA-Z0-9]+\)\.md$/);
	});

	it('ics recurring events — same eventId, different dates, no conflict', () => {
		// ICS recurring events share the same UID but have different startDates
		const e1 = { title: 'Standup', startDate: new Date(2026, 2, 1, 9, 0, 0), eventId: 'standup-001@test', start: new Date(2026, 2, 1, 9, 0, 0).toISOString() };
		const e2 = { title: 'Standup', startDate: new Date(2026, 2, 2, 9, 0, 0), eventId: 'standup-001@test', start: new Date(2026, 2, 2, 9, 0, 0).toISOString() };
		const e3 = { title: 'Standup', startDate: new Date(2026, 2, 3, 9, 0, 0), eventId: 'standup-001@test', start: new Date(2026, 2, 3, 9, 0, 0).toISOString() };
		const map = getNotePaths([e1, e2, e3], settings);
		// Each occurrence is in a different date folder — no conflict, no suffix
		expect(map.get(key('standup-001@test', e1.start))).toBe('Meetings/2026-03-01/0900 Standup.md');
		expect(map.get(key('standup-001@test', e2.start))).toBe('Meetings/2026-03-02/0900 Standup.md');
		expect(map.get(key('standup-001@test', e3.start))).toBe('Meetings/2026-03-03/0900 Standup.md');
	});

	it('legacy path conflict — both events get shortId suffix', () => {
		const legacySettings = { notesFolder: 'Notes', dateFormat: 'YYYY-MM-DD' };
		const a = makeEvent('id-111', 'Standup');
		const b = makeEvent('id-222', 'Standup');
		const map = getNotePaths([a, b], legacySettings);
		const pathA = map.get(key('id-111', a.start))!;
		const pathB = map.get(key('id-222', b.start))!;
		expect(pathA).toMatch(/2026-03-01 Standup \([a-zA-Z0-9]+\)\.md$/);
		expect(pathB).toMatch(/2026-03-01 Standup \([a-zA-Z0-9]+\)\.md$/);
		expect(pathA).not.toBe(pathB);
	});
});

// ─── fillTemplate ─────────────────────────────────────────────────────────────

describe('fillTemplate', () => {
	const settings = { ...DEFAULT_SETTINGS };

	const event: CalendarEvent = {
		uid: 'abc-123',
		title: 'Weekly Sync',
		description: 'Discuss progress',
		location: 'Zoom',
		startDate: new Date(2024, 0, 15, 9, 0, 0),
		endDate: new Date(2024, 0, 15, 10, 0, 0),
		isAllDay: false,
		isRecurring: true,
		attendees: [
			{ name: 'Alice', email: 'alice@example.com', role: 'REQ-PARTICIPANT' },
			{ email: 'bob@example.com' },
		],
		organizer: 'Carol <carol@example.com>',
		sourceId: 'src1',
		sourceName: 'Work Calendar',
	};

	it('replaces {{title}}', () => {
		const out = fillTemplate('{{title}}', event, settings);
		expect(out).toBe('Weekly Sync');
	});

	it('replaces {{description}}', () => {
		const out = fillTemplate('{{description}}', event, settings);
		expect(out).toBe('Discuss progress');
	});

	it('replaces {{location}}', () => {
		const out = fillTemplate('{{location}}', event, settings);
		expect(out).toBe('Zoom');
	});

	it('replaces {{organizer}}', () => {
		const out = fillTemplate('{{organizer}}', event, settings);
		expect(out).toBe('Carol <carol@example.com>');
	});

	it('replaces {{source}}', () => {
		const out = fillTemplate('{{source}}', event, settings);
		expect(out).toBe('Work Calendar');
	});

	it('renders attendee list', () => {
		const out = fillTemplate('{{attendees}}', event, settings);
		expect(out).toContain('Alice <alice@example.com>');
		expect(out).toContain('bob@example.com');
	});

	it('renders series_link when provided', () => {
		const out = fillTemplate('{{series_link}}', event, settings, '[[Weekly Sync Series]]');
		expect(out).toContain('[[Weekly Sync Series]]');
	});

	it('renders empty string for series_link when not provided', () => {
		const out = fillTemplate('{{series_link}}', event, settings);
		expect(out).toBe('');
	});

	it('replaces multiple occurrences of the same placeholder', () => {
		const out = fillTemplate('{{title}} — {{title}}', event, settings);
		expect(out).toBe('Weekly Sync — Weekly Sync');
	});

	it('marks all-day events correctly', () => {
		const allDay = { ...event, isAllDay: true };
		const out = fillTemplate('{{time}}', allDay, settings);
		expect(out).toBe('All day');
	});

	it('produces a well-formed note from the default template', () => {
		const out = fillTemplate(DEFAULT_TEMPLATE, event, settings, '[[Weekly Sync]]');
		expect(out).toContain('# Weekly Sync');
		expect(out).toContain('<!-- AUTOGEN:AGENDA:START -->');
		expect(out).toContain('<!-- AUTOGEN:AGENDA:END -->');
		expect(out).toContain('## Notes');
		expect(out).toContain('## Action Items');
	});
});

// ─── updateAutogenBlocks ──────────────────────────────────────────────────────

describe('updateAutogenBlocks', () => {
	const makeNote = (autogenBody: string, manual: string) =>
		`# Title\n\n${AUTOGEN_START}\n${autogenBody}\n${AUTOGEN_END}\n\n${manual}`;

	it('updates the AUTOGEN block while preserving content outside it', () => {
		const existing = makeNote('old content', '## My Notes\nKeep this!');
		const newNote = makeNote('new content', '## My Notes\nDifferent');
		const result = updateAutogenBlocks(existing, newNote);

		expect(result).toContain('new content');
		expect(result).not.toContain('old content');
		expect(result).toContain('Keep this!');   // manual section preserved
	});

	it('is idempotent — applying the same update twice gives the same result', () => {
		const existing = makeNote('original', '## Notes\nManual');
		const newNote = makeNote('updated', '## Notes\nManual');

		const once = updateAutogenBlocks(existing, newNote);
		const twice = updateAutogenBlocks(once, newNote);
		expect(once).toBe(twice);
	});

	it('appends an AUTOGEN block when the existing note has none', () => {
		const existing = '# Title\n\nSome content without autogen';
		const newNote = `# Title\n\n${AUTOGEN_START}\nauto data\n${AUTOGEN_END}`;
		const result = updateAutogenBlocks(existing, newNote);

		expect(result).toContain('Some content without autogen');
		expect(result).toContain(AUTOGEN_START);
		expect(result).toContain('auto data');
	});

	it('returns existing content unchanged when new content has no AUTOGEN block', () => {
		const existing = makeNote('existing autogen', '## Notes');
		const newNote = '# Title\n\nNo autogen here';
		expect(updateAutogenBlocks(existing, newNote)).toBe(existing);
	});

	it('handles multi-line AUTOGEN content correctly', () => {
		const existing = makeNote('line1\nline2\nline3', '## Notes\nManual text');
		const newNote = makeNote('alpha\nbeta\ngamma', '## Notes\nIgnored');
		const result = updateAutogenBlocks(existing, newNote);

		expect(result).toContain('alpha\nbeta\ngamma');
		expect(result).not.toContain('line1');
		expect(result).toContain('Manual text');
	});
});

// ─── slugify ─────────────────────────────────────────────────────────────────

describe('slugify', () => {
	it('lowercases and hyphenates words', () => {
		expect(slugify('Daily Standup')).toBe('daily-standup');
	});

	it('replaces non-alphanumeric runs with a single hyphen', () => {
		expect(slugify('TA Standup / weekly')).toBe('ta-standup-weekly');
	});

	it('strips leading and trailing hyphens', () => {
		expect(slugify('!Meeting!')).toBe('meeting');
	});

	it('truncates at 100 characters', () => {
		const long = 'a'.repeat(120);
		expect(slugify(long).length).toBe(100);
	});

	it('handles empty string', () => {
		expect(slugify('')).toBe('');
	});
});

// ─── getSeriesPagePath ───────────────────────────────────────────────────────

describe('getSeriesPagePath', () => {
	it('uses seriesRoot when provided', () => {
		const path = getSeriesPagePath('Daily Standup', { seriesRoot: 'Archive/Series' });
		expect(path).toBe('Archive/Series/daily-standup.md');
	});

	it('falls back to seriesFolder', () => {
		const path = getSeriesPagePath('Weekly Review', { seriesFolder: 'Meetings/Series' });
		expect(path).toBe('Meetings/Series/weekly-review.md');
	});

	it('uses default path when settings are empty', () => {
		const path = getSeriesPagePath('My Series', {});
		expect(path).toBe('Meetings/_series/my-series.md');
	});
});

// ─── NormalizedEvent helpers ─────────────────────────────────────────────────

function makeNormalized(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
	return {
		source:      'ics_public',
		calendarId:  'cal1',
		eventId:     'evt-001',
		uid:         'evt-001',
		title:       'Team Standup',
		start:       '2024-01-15T09:00:00Z',
		end:         '2024-01-15T10:00:00Z',
		startDate:   new Date('2024-01-15T09:00:00Z'),
		endDate:     new Date('2024-01-15T10:00:00Z'),
		isAllDay:    false,
		status:      'confirmed',
		seriesKey:   'ical:standup-001',
		isRecurring: false,
		sourceName:  'Work Calendar',
		...overrides,
	};
}

// ─── buildFrontmatter ────────────────────────────────────────────────────────

describe('buildFrontmatter', () => {
	const settings = { ...DEFAULT_SETTINGS } as PluginSettings;

	it('includes required fields for any event', () => {
		const fm = buildFrontmatter(makeNormalized(), settings);
		expect(fm).toContain('type: meeting');
		expect(fm).toContain('title:');
		expect(fm).toContain('start:');
		expect(fm).toContain('status: confirmed');
		expect(fm).toContain('draft: true');
	});

	it('includes series_key and series_name for recurring events', () => {
		const fm = buildFrontmatter(
			makeNormalized({ isRecurring: true }),
			settings,
		);
		expect(fm).toContain('series_key:');
		expect(fm).toContain('series_name:');
	});

	it('omits series fields for non-recurring events', () => {
		const fm = buildFrontmatter(
			makeNormalized({ isRecurring: false }),
			settings,
		);
		expect(fm).not.toContain('series_key');
	});

	it('omits attendees when redactionMode is true', () => {
		const s = { ...settings, redactionMode: true };
		const fm = buildFrontmatter(
			makeNormalized({ attendees: [{ email: 'alice@example.com' }] }),
			s,
		);
		expect(fm).not.toContain('alice@example.com');
	});

	it('includes attendees when redactionMode is false', () => {
		const fm = buildFrontmatter(
			makeNormalized({ attendees: [{ email: 'alice@example.com' }] }),
			{ ...settings, redactionMode: false },
		);
		expect(fm).toContain('alice@example.com');
	});

	it('includes profile tags in the frontmatter', () => {
		const profile: SeriesProfile = {
			seriesKey: 'ical:standup-001', seriesName: 'Standup', enabled: true,
			tags: ['work', 'engineering'],
		};
		const fm = buildFrontmatter(
			makeNormalized({ isRecurring: true }),
			settings,
			profile,
		);
		expect(fm).toContain('work');
		expect(fm).toContain('engineering');
	});

	it('includes timezone when set on event', () => {
		const fm = buildFrontmatter(
			makeNormalized({ timezone: 'America/Los_Angeles' }),
			settings,
		);
		expect(fm).toContain('timezone: America/Los_Angeles');
	});
});

	describe('buildFrontmatter — meeting_url canonical field', () => {
	const settings = { ...DEFAULT_SETTINGS } as PluginSettings;

	it('emits meeting_url when event.meetingUrl is set', () => {
		const fm = buildFrontmatter(
			makeNormalized({ meetingUrl: 'https://teams.microsoft.com/l/meetup-join/abc' }),
			settings,
		);
		expect(fm).toContain('meeting_url: https://teams.microsoft.com/l/meetup-join/abc');
	});

	it('does not emit meet_url or teams_url (old fields removed)', () => {
		const fm = buildFrontmatter(
			makeNormalized({ meetingUrl: 'https://zoom.us/j/123' }),
			settings,
		);
		expect(fm).not.toContain('meet_url');
		expect(fm).not.toContain('teams_url');
	});

	it('omits meeting_url when event.meetingUrl is undefined', () => {
		const fm = buildFrontmatter(makeNormalized({ meetingUrl: undefined }), settings);
		expect(fm).not.toContain('meeting_url');
	});
});

// ─── buildAgendaBlock ────────────────────────────────────────────────────────

describe('buildAgendaBlock', () => {
	it('uses profile defaultAgenda when provided', () => {
		const profile: SeriesProfile = {
			seriesKey: 'k', seriesName: 'S', enabled: true,
			defaultAgenda: 'Sprint updates\nBlockers',
		};
		const block = buildAgendaBlock(makeNormalized(), profile);
		expect(block).toContain('Sprint updates');
		expect(block).not.toContain('## Agenda');
	});

	it('falls back to event description when no profile agenda', () => {
		const block = buildAgendaBlock(
			makeNormalized({ description: 'Review PRs' }),
		);
		expect(block).toContain('## Agenda');
		expect(block).toContain('Review PRs');
	});

	it('returns placeholder when no agenda and no description', () => {
		const block = buildAgendaBlock(makeNormalized({ description: undefined }));
		expect(block).toContain('*(No agenda set)*');
	});
});

// ─── buildJoinersBlock ───────────────────────────────────────────────────────

describe('buildJoinersBlock', () => {
	const s = { ...DEFAULT_SETTINGS } as PluginSettings;

	it('returns redacted block in redactionMode', () => {
		const block = buildJoinersBlock(
			makeNormalized({ attendees: [{ email: 'alice@example.com' }] }),
			{ ...s, redactionMode: true },
		);
		expect(block).toContain('*(redacted)*');
		expect(block).not.toContain('alice');
	});

	it('returns unknown attendees placeholder when no attendees', () => {
		const block = buildJoinersBlock(makeNormalized({ attendees: [] }), s);
		expect(block).toContain('*(Unknown');
	});

	it('splits required and optional attendees', () => {
		const event = makeNormalized({
			attendees: [
				{ email: 'alice@example.com', optional: false },
				{ email: 'bob@example.com',   optional: true },
			],
		});
		const block = buildJoinersBlock(event, s);
		expect(block).toContain('**Required:**');
		expect(block).toContain('**Optional:**');
		expect(block).toContain('alice@example.com');
		expect(block).toContain('bob@example.com');
	});

	it('hides attendees listed in profile.hiddenAttendees', () => {
		const profile: SeriesProfile = {
			seriesKey: 'k', seriesName: 'S', enabled: true,
			hiddenAttendees: ['bot@example.com'],
		};
		const event = makeNormalized({
			attendees: [
				{ email: 'alice@example.com' },
				{ email: 'bot@example.com' },
			],
		});
		const block = buildJoinersBlock(event, s, profile);
		expect(block).not.toContain('bot@example.com');
		expect(block).toContain('alice@example.com');
	});

	it('pins attendees listed in profile.pinnedAttendees even if absent', () => {
		const profile: SeriesProfile = {
			seriesKey: 'k', seriesName: 'S', enabled: true,
			pinnedAttendees: ['pinned@example.com'],
		};
		const event = makeNormalized({ attendees: [{ email: 'alice@example.com' }] });
		const block = buildJoinersBlock(event, s, profile);
		expect(block).toContain('pinned@example.com');
	});
});

// ─── buildLinksBlock ─────────────────────────────────────────────────────────

describe('buildLinksBlock', () => {
	const event = makeNormalized();

	it('includes cancelled warning when cancelled=true', () => {
		const block = buildLinksBlock({ event, cancelled: true });
		expect(block).toContain('cancelled');
	});

	it('does not include cancelled warning when confirmed', () => {
		const block = buildLinksBlock({ event, cancelled: false });
		expect(block).not.toContain('cancelled');
	});

	it('includes series wikilink when seriesPagePath is provided', () => {
		const block = buildLinksBlock({
			event,
			seriesPagePath: 'Meetings/Series/team-standup.md',
		});
		expect(block).toContain('[[team-standup]]');
	});

	it('includes prev wikilink when prevPath is provided', () => {
		const block = buildLinksBlock({ event, prevPath: 'Meetings/2024-01-14 Standup.md' });
		expect(block).toContain('[[2024-01-14 Standup]]');
	});

	it('includes next wikilink when nextPath is provided', () => {
		const block = buildLinksBlock({ event, nextPath: 'Meetings/2024-01-16 Standup.md' });
		expect(block).toContain('[[2024-01-16 Standup]]');
	});

	it('returns only ## Links when all optional params are absent', () => {
		const block = buildLinksBlock({ event });
		expect(block.trim()).toBe('## Links');
	});
});

	it('includes join meeting link when meetingUrl is set', () => {
		const block = buildLinksBlock({
			event: makeNormalized({ meetingUrl: 'https://meet.google.com/abc-def' }),
		});
		expect(block).toContain('🔗 Join Meeting');
		expect(block).toContain('https://meet.google.com/abc-def');
	});

	it('omits join meeting line when meetingUrl is absent', () => {
		const block = buildLinksBlock({ event: makeNormalized({ meetingUrl: undefined }) });
		expect(block).not.toContain('Join Meeting');
	});

// ─── fillTemplateNormalized ───────────────────────────────────────────────────

describe('fillTemplateNormalized', () => {
	const settings = { ...DEFAULT_SETTINGS } as PluginSettings;

	it('replaces {{title}}', () => {
		const out = fillTemplateNormalized('{{title}}', { event: makeNormalized(), settings });
		expect(out).toBe('Team Standup');
	});

	it('renders All day for all-day events', () => {
		const out = fillTemplateNormalized('{{start_human}} {{duration}}', {
			event: makeNormalized({ isAllDay: true }),
			settings,
		});
		expect(out).toContain('All day');
	});

	it('replaces {{calendar}} with sourceName', () => {
		const out = fillTemplateNormalized('{{calendar}}', {
			event: makeNormalized({ sourceName: 'Engineering Cal' }),
			settings,
		});
		expect(out).toBe('Engineering Cal');
	});

	it('renders frontmatter placeholder', () => {
		const out = fillTemplateNormalized('{{frontmatter}}', { event: makeNormalized(), settings });
		expect(out).toContain('type: meeting');
	});

	it('renders the full default template without errors', () => {
		const out = fillTemplateNormalized(DEFAULT_TEMPLATE, {
			event: makeNormalized({ isRecurring: true }),
			settings,
			seriesPagePath: 'Meetings/Series/team-standup.md',
			prevPath: 'Meetings/2024-01-14 Standup.md',
			nextPath: 'Meetings/2024-01-16 Standup.md',
		});
		expect(out).toContain('# Team Standup');
		expect(out).toContain(AUTOGEN_AGENDA_START);
		expect(out).toContain(AUTOGEN_AGENDA_END);
		expect(out).toContain(AUTOGEN_JOINERS_START);
		expect(out).toContain(AUTOGEN_LINKS_START);
	});

	it('includes profile seriesName in {{series_name}}', () => {
		const profile: SeriesProfile = {
			seriesKey: 'ical:standup-001', seriesName: 'Engineering Standup', enabled: true,
		};
		const out = fillTemplateNormalized('{{series_name}}', {
			event: makeNormalized({ isRecurring: true }),
			settings,
			profile,
		});
		expect(out).toBe('Engineering Standup');
	});

	it('replaces {{date}} with formatted event date', () => {
		const s = { ...DEFAULT_SETTINGS, dateFormat: 'YYYY-MM-DD' } as PluginSettings;
		const out = fillTemplateNormalized('{{date}}', {
			event: makeNormalized({ startDate: new Date(2024, 0, 15, 9, 0, 0) }),
			settings: s,
		});
		expect(out).toBe('2024-01-15');
	});

	it('replaces {{time}} with formatted start time', () => {
		const s = { ...DEFAULT_SETTINGS, timeFormat: 'HH:mm' } as PluginSettings;
		const out = fillTemplateNormalized('{{time}}', {
			event: makeNormalized({ startDate: new Date(2024, 0, 15, 9, 5, 0) }),
			settings: s,
		});
		expect(out).toBe('09:05');
	});

	it('replaces {{end_time}} with formatted end time', () => {
		const s = { ...DEFAULT_SETTINGS, timeFormat: 'HH:mm' } as PluginSettings;
		const out = fillTemplateNormalized('{{end_time}}', {
			event: makeNormalized({
				startDate: new Date(2024, 0, 15, 9, 0, 0),
				endDate:   new Date(2024, 0, 15, 9, 30, 0),
			}),
			settings: s,
		});
		expect(out).toBe('09:30');
	});

	it('replaces {{time}} with "All day" for all-day events', () => {
		const out = fillTemplateNormalized('{{time}}', {
			event: makeNormalized({ isAllDay: true }),
			settings,
		});
		expect(out).toBe('All day');
	});
});

// ─── updateAutogenBlocksNamed ─────────────────────────────────────────────────

describe('updateAutogenBlocksNamed', () => {
	const wrap = (name: string, body: string) =>
		`<!-- AUTOGEN:${name}:START -->
${body}
<!-- AUTOGEN:${name}:END -->`;

	it('replaces an existing named AGENDA block', () => {
		const existing = `# Note

${wrap('AGENDA', 'old agenda')}

## Notes`;
		const result = updateAutogenBlocksNamed(existing, {
			agendaBody:   'new agenda',
			joinersBody:  '',
			linksBody:    '',
		});
		expect(result).toContain('new agenda');
		expect(result).not.toContain('old agenda');
		expect(result).toContain('## Notes');
	});

	it('appends a missing JOINERS block', () => {
		const existing = `# Note

${wrap('AGENDA', 'agenda')}

## Notes`;
		const result = updateAutogenBlocksNamed(existing, {
			agendaBody:   'agenda',
			joinersBody:  'Alice',
			linksBody:    '',
		});
		expect(result).toContain('AUTOGEN:JOINERS:START');
		expect(result).toContain('Alice');
	});

	it('replaces all three blocks when all are present', () => {
		const existing = [
			`# Note`,
			wrap('AGENDA',  'old-a'),
			wrap('JOINERS', 'old-j'),
			wrap('LINKS',   'old-l'),
		].join('\n\n');
		const result = updateAutogenBlocksNamed(existing, {
			agendaBody:   'new-a',
			joinersBody:  'new-j',
			linksBody:    'new-l',
		});
		expect(result).toContain('new-a');
		expect(result).toContain('new-j');
		expect(result).toContain('new-l');
		expect(result).not.toContain('old-a');
		expect(result).not.toContain('old-j');
		expect(result).not.toContain('old-l');
	});

	it('preserves content outside all AUTOGEN blocks', () => {
		const existing = `# Note

${wrap('AGENDA', 'a')}

## My Notes
User content`;
		const result = updateAutogenBlocksNamed(existing, {
			agendaBody:   'updated',
			joinersBody:  '',
			linksBody:    '',
		});
		expect(result).toContain('User content');
	});
});
