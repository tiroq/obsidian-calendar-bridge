import {
	addDuration,
	expandRRule,
	isSameDay,
	parseAndFilterEvents,
	parseICSDate,
	parseLine,
	parseRRule,
	unfoldLines,
	unescapeText,
} from '../src/ics-parser';

// ─── unfoldLines ──────────────────────────────────────────────────────────────

describe('unfoldLines', () => {
	it('splits on LF', () => {
		expect(unfoldLines('A\nB\nC')).toEqual(['A', 'B', 'C']);
	});

	it('splits on CRLF', () => {
		expect(unfoldLines('A\r\nB\r\nC')).toEqual(['A', 'B', 'C']);
	});

	it('unfolds continuation lines (space)', () => {
		expect(unfoldLines('ABCD\n EF')).toEqual(['ABCDEF']);
	});

	it('unfolds continuation lines (tab)', () => {
		expect(unfoldLines('ABCD\n\tEF')).toEqual(['ABCDEF']);
	});
});

// ─── parseLine ────────────────────────────────────────────────────────────────

describe('parseLine', () => {
	it('parses a simple property', () => {
		const result = parseLine('SUMMARY:Team Standup');
		expect(result).toEqual({ name: 'SUMMARY', params: {}, value: 'Team Standup' });
	});

	it('parses property parameters', () => {
		const result = parseLine('DTSTART;TZID=America/New_York:20240115T090000');
		expect(result?.name).toBe('DTSTART');
		expect(result?.params).toEqual({ TZID: 'America/New_York' });
		expect(result?.value).toBe('20240115T090000');
	});

	it('strips quotes from parameter values', () => {
		const result = parseLine('ATTENDEE;CN="Alice Smith":mailto:alice@example.com');
		expect(result?.params.CN).toBe('Alice Smith');
		expect(result?.value).toBe('mailto:alice@example.com');
	});

	it('returns null when no colon found', () => {
		expect(parseLine('NO_COLON_HERE')).toBeNull();
	});

	it('handles colons inside quoted parameter values', () => {
		const result = parseLine('X-PROP;PARAM="val:ue":actual:value');
		expect(result?.value).toBe('actual:value');
	});
});

// ─── unescapeText ─────────────────────────────────────────────────────────────

describe('unescapeText', () => {
	it('unescapes backslash-n to newline', () => {
		expect(unescapeText('Line1\\nLine2')).toBe('Line1\nLine2');
	});

	it('unescapes \\, to comma', () => {
		expect(unescapeText('one\\,two')).toBe('one,two');
	});

	it('unescapes \\; to semicolon', () => {
		expect(unescapeText('one\\;two')).toBe('one;two');
	});

	it('unescapes \\\\ to single backslash', () => {
		expect(unescapeText('back\\\\slash')).toBe('back\\slash');
	});
});

// ─── parseICSDate ─────────────────────────────────────────────────────────────

describe('parseICSDate', () => {
	it('parses all-day date (DATE format)', () => {
		const { date, isAllDay } = parseICSDate('20240115');
		expect(isAllDay).toBe(true);
		expect(date.getFullYear()).toBe(2024);
		expect(date.getMonth()).toBe(0); // January
		expect(date.getDate()).toBe(15);
	});

	it('parses UTC datetime', () => {
		const { date, isAllDay } = parseICSDate('20240115T090000Z');
		expect(isAllDay).toBe(false);
		expect(date.toISOString()).toBe('2024-01-15T09:00:00.000Z');
	});

	it('parses local datetime (no Z)', () => {
		const { date, isAllDay } = parseICSDate('20240115T090000');
		expect(isAllDay).toBe(false);
		// Just verify the date parts are preserved (local time parsing)
		expect(date.getFullYear()).toBe(2024);
		expect(date.getMonth()).toBe(0);
		expect(date.getDate()).toBe(15);
		expect(date.getHours()).toBe(9);
	});
});

// ─── addDuration ─────────────────────────────────────────────────────────────

describe('addDuration', () => {
	const base = new Date('2024-01-15T09:00:00Z');

	it('adds hours (PT1H)', () => {
		const result = addDuration(base, 'PT1H');
		expect(result.toISOString()).toBe('2024-01-15T10:00:00.000Z');
	});

	it('adds minutes (PT30M)', () => {
		const result = addDuration(base, 'PT30M');
		expect(result.toISOString()).toBe('2024-01-15T09:30:00.000Z');
	});

	it('adds days (P1D)', () => {
		const result = addDuration(base, 'P1D');
		expect(result.toISOString()).toBe('2024-01-16T09:00:00.000Z');
	});

	it('adds weeks (P2W)', () => {
		const result = addDuration(base, 'P2W');
		expect(result.toISOString()).toBe('2024-01-29T09:00:00.000Z');
	});

	it('returns original date for unrecognised format', () => {
		const result = addDuration(base, 'INVALID');
		expect(result.toISOString()).toBe(base.toISOString());
	});
});

// ─── isSameDay ────────────────────────────────────────────────────────────────

describe('isSameDay', () => {
	it('returns true for same day', () => {
		expect(isSameDay(new Date('2024-01-15T09:00:00'), new Date('2024-01-15T18:00:00'))).toBe(true);
	});

	it('returns false for different days', () => {
		expect(isSameDay(new Date('2024-01-15'), new Date('2024-01-16'))).toBe(false);
	});
});

// ─── parseRRule ───────────────────────────────────────────────────────────────

describe('parseRRule', () => {
	it('parses a simple WEEKLY rule', () => {
		const r = parseRRule('FREQ=WEEKLY;INTERVAL=1');
		expect(r?.freq).toBe('WEEKLY');
		expect(r?.interval).toBe(1);
	});

	it('parses COUNT', () => {
		const r = parseRRule('FREQ=DAILY;COUNT=5');
		expect(r?.count).toBe(5);
	});

	it('parses UNTIL', () => {
		const r = parseRRule('FREQ=MONTHLY;UNTIL=20241231T000000Z');
		expect(r?.until).toBeDefined();
		expect(r?.until?.getFullYear()).toBe(2024);
	});

	it('parses BYDAY', () => {
		const r = parseRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR');
		expect(r?.byday).toEqual(['MO', 'WE', 'FR']);
	});

	it('returns null when FREQ is missing', () => {
		expect(parseRRule('INTERVAL=2')).toBeNull();
	});
});

// ─── expandRRule ──────────────────────────────────────────────────────────────

describe('expandRRule — DAILY', () => {
	const dtstart = new Date('2024-01-15T09:00:00Z');
	const from = new Date('2024-01-15T00:00:00Z');
	const to = new Date('2024-01-19T23:59:59Z');

	it('expands 5 daily occurrences', () => {
		const rrule = parseRRule('FREQ=DAILY;COUNT=5')!;
		const dates = expandRRule(dtstart, rrule, [], from, to);
		expect(dates).toHaveLength(5);
	});

	it('respects to boundary', () => {
		const rrule = parseRRule('FREQ=DAILY')!;
		const dates = expandRRule(dtstart, rrule, [], from, to);
		for (const d of dates) {
			expect(d.getTime()).toBeLessThanOrEqual(to.getTime());
		}
	});

	it('skips exdate dates', () => {
		const rrule = parseRRule('FREQ=DAILY')!;
		const exdate = new Date('2024-01-16T09:00:00Z');
		const dates = expandRRule(dtstart, rrule, [exdate], from, to);
		const hasExcluded = dates.some(d => isSameDay(d, exdate));
		expect(hasExcluded).toBe(false);
	});

	it('respects INTERVAL=2', () => {
		const rrule = parseRRule('FREQ=DAILY;INTERVAL=2')!;
		const dates = expandRRule(dtstart, rrule, [], from, to);
		expect(dates.length).toBeGreaterThan(0);
		// Verify gap between consecutive occurrences is 2 days
		for (let i = 1; i < dates.length; i++) {
			const diff = (dates[i].getTime() - dates[i - 1].getTime()) / 86_400_000;
			expect(diff).toBe(2);
		}
	});
});

describe('expandRRule — WEEKLY no BYDAY', () => {
	const dtstart = new Date('2024-01-15T09:00:00Z'); // Monday
	const from = new Date('2024-01-15T00:00:00Z');
	const to = new Date('2024-02-12T23:59:59Z');

	it('returns one occurrence per week', () => {
		const rrule = parseRRule('FREQ=WEEKLY')!;
		const dates = expandRRule(dtstart, rrule, [], from, to);
		expect(dates.length).toBeGreaterThanOrEqual(4);
		for (let i = 1; i < dates.length; i++) {
			const diff = (dates[i].getTime() - dates[i - 1].getTime()) / 86_400_000;
			expect(diff).toBe(7);
		}
	});
});

describe('expandRRule — WEEKLY with BYDAY', () => {
	// MWF stand-up starting 2024-01-15 (Monday)
	const dtstart = new Date('2024-01-15T09:00:00');
	const from = new Date('2024-01-15T00:00:00');
	const to = new Date('2024-01-21T23:59:59');

	it('expands MO,WE,FR within a single week', () => {
		const rrule = parseRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR')!;
		const dates = expandRRule(dtstart, rrule, [], from, to);
		expect(dates).toHaveLength(3);
		// Verify days of week: 1=Mon, 3=Wed, 5=Fri
		expect(dates[0].getDay()).toBe(1);
		expect(dates[1].getDay()).toBe(3);
		expect(dates[2].getDay()).toBe(5);
	});
});

describe('expandRRule — MONTHLY', () => {
	const dtstart = new Date('2024-01-15T09:00:00Z');
	const from = new Date('2024-01-01T00:00:00Z');
	const to = new Date('2024-06-30T23:59:59Z');

	it('returns 6 monthly occurrences', () => {
		const rrule = parseRRule('FREQ=MONTHLY')!;
		const dates = expandRRule(dtstart, rrule, [], from, to);
		expect(dates).toHaveLength(6);
	});
});

describe('expandRRule — YEARLY', () => {
	const dtstart = new Date('2023-01-15T09:00:00Z');
	const from = new Date('2023-01-01T00:00:00Z');
	const to = new Date('2025-12-31T23:59:59Z');

	it('returns 3 yearly occurrences', () => {
		const rrule = parseRRule('FREQ=YEARLY')!;
		const dates = expandRRule(dtstart, rrule, [], from, to);
		expect(dates).toHaveLength(3);
		expect(dates[0].getFullYear()).toBe(2023);
		expect(dates[1].getFullYear()).toBe(2024);
		expect(dates[2].getFullYear()).toBe(2025);
	});
});

// ─── parseAndFilterEvents (integration) ──────────────────────────────────────

const SIMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:simple-001@test
SUMMARY:Team Meeting
DESCRIPTION:Weekly sync
LOCATION:Conference Room A
DTSTART:20240115T090000Z
DTEND:20240115T100000Z
END:VEVENT
END:VCALENDAR`;

const RECURRING_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:recurring-001@test
SUMMARY:Daily Standup
DTSTART:20240115T090000Z
DTEND:20240115T091500Z
RRULE:FREQ=DAILY;COUNT=5
END:VEVENT
END:VCALENDAR`;

const ATTENDEE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:attendee-001@test
SUMMARY:Planning Session
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
ORGANIZER;CN=Alice Smith:mailto:alice@example.com
ATTENDEE;CN=Bob Jones;ROLE=REQ-PARTICIPANT:mailto:bob@example.com
ATTENDEE;CN=Carol White:mailto:carol@example.com
END:VEVENT
END:VCALENDAR`;

const ALLDAY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:allday-001@test
SUMMARY:Company Holiday
DTSTART;VALUE=DATE:20240115
DTEND;VALUE=DATE:20240116
END:VEVENT
END:VCALENDAR`;

const EXDATE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:exdate-001@test
SUMMARY:Weekly Meeting
DTSTART:20240115T090000Z
DTEND:20240115T100000Z
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE:20240122T090000Z
END:VEVENT
END:VCALENDAR`;

describe('parseAndFilterEvents', () => {
	const from = new Date('2024-01-15T00:00:00Z');
	const to = new Date('2024-01-31T23:59:59Z');

	it('parses a simple non-recurring event', () => {
		const events = parseAndFilterEvents(SIMPLE_ICS, from, to);
		expect(events).toHaveLength(1);
		expect(events[0].uid).toBe('simple-001@test');
		expect(events[0].title).toBe('Team Meeting');
		expect(events[0].description).toBe('Weekly sync');
		expect(events[0].location).toBe('Conference Room A');
		expect(events[0].isRecurring).toBe(false);
	});

	it('excludes events outside the date range', () => {
		const narrowFrom = new Date('2024-01-20T00:00:00Z');
		const narrowTo = new Date('2024-01-25T23:59:59Z');
		const events = parseAndFilterEvents(SIMPLE_ICS, narrowFrom, narrowTo);
		expect(events).toHaveLength(0);
	});

	it('expands a recurring event across the range', () => {
		const events = parseAndFilterEvents(RECURRING_ICS, from, to);
		expect(events.length).toBeGreaterThanOrEqual(5);
		events.forEach(e => {
			expect(e.isRecurring).toBe(true);
			expect(e.uid).toBe('recurring-001@test');
		});
	});

	it('sets isRecurring=true for each expanded occurrence', () => {
		const events = parseAndFilterEvents(RECURRING_ICS, from, to);
		expect(events.every(e => e.isRecurring)).toBe(true);
	});

	it('parses attendees and organizer', () => {
		const events = parseAndFilterEvents(ATTENDEE_ICS, from, to);
		expect(events).toHaveLength(1);
		const e = events[0];
		expect(e.organizerEmail).toBe('alice@example.com');
		expect(e.organizerName).toBe('Alice Smith');
		expect(e.attendees).toHaveLength(2);
		expect(e.attendees[0].name).toBe('Bob Jones');
		expect(e.attendees[0].email).toBe('bob@example.com');
		expect(e.attendees[0].role).toBe('REQ-PARTICIPANT');
	});

	it('handles all-day events', () => {
		const events = parseAndFilterEvents(ALLDAY_ICS, from, to);
		expect(events).toHaveLength(1);
		expect(events[0].isAllDay).toBe(true);
	});

	it('respects EXDATE exclusions', () => {
		// 4 weekly occurrences starting Jan 15; Jan 22 excluded → 3 expected in range
		const events = parseAndFilterEvents(EXDATE_ICS, from, to);
		const jan22 = new Date('2024-01-22T09:00:00Z');
		expect(events.some(e => isSameDay(e.startDate, jan22))).toBe(false);
		// Should have Jan 15, Jan 29 (Jan 22 excluded, Jan 5 out of count)
		expect(events.length).toBeLessThan(4);
	});

	it('handles line folding in the ICS data', () => {
		// RFC 5545: fold indicator is one leading whitespace that gets removed;
		// the content space before the fold must be preserved separately.
		const folded = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fold-001@test\r\nSUMMARY:Long Title That Has \r\n Been Folded\r\nDTSTART:20240115T090000Z\r\nDTEND:20240115T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR`;
		const events = parseAndFilterEvents(folded, from, to);
		expect(events).toHaveLength(1);
		expect(events[0].title).toBe('Long Title That Has Been Folded');
	});
});
