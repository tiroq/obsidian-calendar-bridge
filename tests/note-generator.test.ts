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
