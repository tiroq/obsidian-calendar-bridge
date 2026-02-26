import {
	DEFAULT_TEMPLATE,
	AUTOGEN_END,
	AUTOGEN_START,
	fillTemplate,
	formatDate,
	formatDuration,
	getNotePath,
	sanitizeFilename,
	updateAutogenBlocks,
} from '../src/note-generator';
import { CalendarEvent, DEFAULT_SETTINGS } from '../src/types';

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
	const settings = { ...DEFAULT_SETTINGS, notesFolder: 'Meetings', dateFormat: 'YYYY-MM-DD' };

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
		expect(out).toContain(AUTOGEN_START);
		expect(out).toContain(AUTOGEN_END);
		expect(out).toContain('[[Weekly Sync]]');
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
