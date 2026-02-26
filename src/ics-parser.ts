/**
 * Minimal RFC 5545 iCalendar parser for Calendar Bridge.
 *
 * Handles the subset of iCalendar needed for meeting-note generation:
 *   - VEVENT extraction with line-folding support
 *   - DTSTART / DTEND / DURATION (date and datetime values, UTC and local)
 *   - RRULE expansion: DAILY, WEEKLY (incl. BYDAY), MONTHLY, YEARLY
 *   - EXDATE exceptions
 *   - ATTENDEE / ORGANIZER
 *   - Text value unescaping
 *
 * No external dependencies are required.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AttendeeInfo {
	email: string;
	name?: string;
	role?: string;
}

export interface ParsedICSEvent {
	uid: string;
	title: string;
	description: string;
	location: string;
	startDate: Date;
	endDate: Date;
	isAllDay: boolean;
	/** True when this event is an instance of a recurring series */
	isRecurring: boolean;
	attendees: AttendeeInfo[];
	organizerEmail?: string;
	organizerName?: string;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface ParsedLine {
	name: string;
	params: Record<string, string>;
	value: string;
}

interface RawVEvent {
	uid: string;
	title: string;
	description: string;
	location: string;
	startDate: Date;
	endDate: Date;
	isAllDay: boolean;
	rrule?: string;
	exdates: Date[];
	attendees: AttendeeInfo[];
	organizerEmail?: string;
	organizerName?: string;
}

export interface RRuleParams {
	freq: 'SECONDLY' | 'MINUTELY' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
	interval: number;
	count?: number;
	until?: Date;
	/** Day-of-week codes, e.g. ['MO', 'WE', 'FR'] */
	byday?: string[];
	bymonthday?: number[];
}

// ─── Line parsing ─────────────────────────────────────────────────────────────

/**
 * Unfold RFC 5545 line continuations (CRLF or LF followed by a whitespace
 * character) and split into individual property lines.
 */
export function unfoldLines(icsData: string): string[] {
	return icsData.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

/**
 * Parse one iCalendar property line into its name, parameters, and value.
 * Returns null for lines that are not valid properties.
 */
export function parseLine(line: string): ParsedLine | null {
	// Find the colon that separates name+params from value.
	// Ignore colons that appear inside quoted parameter values.
	let colonIdx = -1;
	let inQuote = false;
	for (let i = 0; i < line.length; i++) {
		if (line[i] === '"') inQuote = !inQuote;
		if (line[i] === ':' && !inQuote) {
			colonIdx = i;
			break;
		}
	}
	if (colonIdx === -1) return null;

	const nameAndParams = line.slice(0, colonIdx);
	const value = line.slice(colonIdx + 1);

	const paramParts = nameAndParams.split(';');
	const name = paramParts[0].toUpperCase();
	const params: Record<string, string> = {};

	for (let i = 1; i < paramParts.length; i++) {
		const eqIdx = paramParts[i].indexOf('=');
		if (eqIdx === -1) continue;
		const key = paramParts[i].slice(0, eqIdx).toUpperCase();
		let val = paramParts[i].slice(eqIdx + 1);
		if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
		params[key] = val;
	}

	return { name, params, value };
}

// ─── Value helpers ────────────────────────────────────────────────────────────

/**
 * Unescape iCalendar TEXT values per RFC 5545 §3.3.11.
 */
export function unescapeText(value: string): string {
	return value
		.replace(/\\n/gi, '\n')
		.replace(/\\,/g, ',')
		.replace(/\\;/g, ';')
		.replace(/\\\\/g, '\\');
}

/**
 * Parse an iCalendar DATE or DATE-TIME string.
 *
 * DATE            → YYYYMMDD           (all-day)
 * DATE-TIME (UTC) → YYYYMMDDTHHMMSSZ
 * DATE-TIME (local/TZID) → YYYYMMDDTHHMMSS
 */
export function parseICSDate(value: string): { date: Date; isAllDay: boolean } {
	if (value.length === 8) {
		const year = parseInt(value.slice(0, 4), 10);
		const month = parseInt(value.slice(4, 6), 10) - 1;
		const day = parseInt(value.slice(6, 8), 10);
		return { date: new Date(year, month, day), isAllDay: true };
	}

	// DATE-TIME: YYYYMMDDTHHMMSS[Z]
	const year = value.slice(0, 4);
	const month = value.slice(4, 6);
	const day = value.slice(6, 8);
	const hour = value.slice(9, 11);
	const min = value.slice(11, 13);
	const sec = value.slice(13, 15);
	const isUtc = value.endsWith('Z');

	const iso = `${year}-${month}-${day}T${hour}:${min}:${sec}${isUtc ? 'Z' : ''}`;
	return { date: new Date(iso), isAllDay: false };
}

/**
 * Add an ISO 8601 DURATION value (e.g. PT1H, P1D, PT30M) to a Date.
 */
export function addDuration(date: Date, duration: string): Date {
	const result = new Date(date);
	const m = duration.match(
		/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/,
	);
	if (!m) return result;
	const [, years, months, weeks, days, hours, minutes, seconds] = m;
	if (years) result.setFullYear(result.getFullYear() + parseInt(years, 10));
	if (months) result.setMonth(result.getMonth() + parseInt(months, 10));
	if (weeks) result.setDate(result.getDate() + parseInt(weeks, 10) * 7);
	if (days) result.setDate(result.getDate() + parseInt(days, 10));
	if (hours) result.setHours(result.getHours() + parseInt(hours, 10));
	if (minutes) result.setMinutes(result.getMinutes() + parseInt(minutes, 10));
	if (seconds) result.setSeconds(result.getSeconds() + parseInt(seconds, 10));
	return result;
}

/**
 * Return true when two Dates fall on the same calendar day (local time).
 */
export function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

// ─── RRULE parsing & expansion ────────────────────────────────────────────────

/** Map of RFC 5545 two-letter day codes to JS getDay() values. */
const DAY_OF_WEEK: Record<string, number> = {
	SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

/**
 * Parse a raw RRULE string (everything after "RRULE:") into structured params.
 */
export function parseRRule(rruleStr: string): RRuleParams | null {
	const p: Record<string, string> = {};
	rruleStr.split(';').forEach(part => {
		const [k, v] = part.split('=');
		if (k && v !== undefined) p[k.toUpperCase()] = v;
	});

	if (!p.FREQ) return null;

	const result: RRuleParams = {
		freq: p.FREQ as RRuleParams['freq'],
		interval: p.INTERVAL ? parseInt(p.INTERVAL, 10) : 1,
	};
	if (p.COUNT) result.count = parseInt(p.COUNT, 10);
	if (p.UNTIL) result.until = parseICSDate(p.UNTIL).date;
	if (p.BYDAY) result.byday = p.BYDAY.split(',').map(s => s.toUpperCase());
	if (p.BYMONTHDAY) result.bymonthday = p.BYMONTHDAY.split(',').map(Number);
	return result;
}

/**
 * Expand a recurring event into individual occurrence start-dates that fall
 * within [from, to] (both inclusive), excluding any EXDATE dates.
 *
 * Supports DAILY, WEEKLY (with optional BYDAY), MONTHLY, YEARLY.
 * Unsupported frequencies return an empty array.
 */
export function expandRRule(
	dtstart: Date,
	rrule: RRuleParams,
	exdates: Date[],
	from: Date,
	to: Date,
): Date[] {
	// Weekly with BYDAY requires special day-of-week expansion
	if (rrule.freq === 'WEEKLY' && rrule.byday && rrule.byday.length > 0) {
		return expandWeeklyByday(dtstart, rrule, exdates, from, to);
	}

	const dates: Date[] = [];
	const MAX = 10_000;
	let iterations = 0;
	let count = 0;
	let current = new Date(dtstart);

	while (iterations++ < MAX) {
		if (rrule.until && current > rrule.until) break;
		if (current > to) break;
		if (rrule.count !== undefined && count >= rrule.count) break;

		if (current >= from && !exdates.some(ex => isSameDay(ex, current))) {
			dates.push(new Date(current));
		}
		count++;

		switch (rrule.freq) {
			case 'DAILY':
				current = new Date(current);
				current.setDate(current.getDate() + rrule.interval);
				break;
			case 'WEEKLY':
				current = new Date(current);
				current.setDate(current.getDate() + 7 * rrule.interval);
				break;
			case 'MONTHLY':
				current = new Date(current);
				current.setMonth(current.getMonth() + rrule.interval);
				break;
			case 'YEARLY':
				current = new Date(current);
				current.setFullYear(current.getFullYear() + rrule.interval);
				break;
			default:
				return dates; // unsupported
		}
	}
	return dates;
}

/**
 * Expand a WEEKLY recurrence with BYDAY (e.g. MO,WE,FR stand-ups).
 * Iterates week-by-week and emits each specified day-of-week occurrence.
 */
function expandWeeklyByday(
	dtstart: Date,
	rrule: RRuleParams,
	exdates: Date[],
	from: Date,
	to: Date,
): Date[] {
	const dates: Date[] = [];
	const targetDows = (rrule.byday ?? [])
		.map(d => DAY_OF_WEEK[d.slice(-2)])
		.filter(d => d !== undefined)
		.sort((a, b) => a - b);

	if (targetDows.length === 0) return dates;

	// Start from the Sunday of the week that contains dtstart
	const startOfWeek = new Date(dtstart);
	startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
	startOfWeek.setHours(
		dtstart.getHours(),
		dtstart.getMinutes(),
		dtstart.getSeconds(),
		0,
	);

	let weekStart = new Date(startOfWeek);
	let weekCount = 0;
	const MAX_WEEKS = 5_000;

	outer: while (weekStart <= to && weekCount++ < MAX_WEEKS) {
		for (const dow of targetDows) {
			const occ = new Date(weekStart);
			occ.setDate(occ.getDate() + dow);
			if (occ < dtstart) continue;
			if (rrule.until && occ > rrule.until) break outer;
			if (occ > to) break outer;

			if (occ >= from && !exdates.some(ex => isSameDay(ex, occ))) {
				dates.push(new Date(occ));
			}
			if (rrule.count !== undefined && dates.length >= rrule.count) break outer;
		}
		weekStart = new Date(weekStart);
		weekStart.setDate(weekStart.getDate() + 7 * rrule.interval);
	}
	return dates;
}

// ─── VEVENT extraction ────────────────────────────────────────────────────────

/**
 * Collect all VEVENT property-line arrays from the unfolded line list.
 */
function extractVEventProps(lines: string[]): Array<ParsedLine[]> {
	const vevents: Array<ParsedLine[]> = [];
	let inVEvent = false;
	let current: ParsedLine[] = [];

	for (const line of lines) {
		if (!line.trim()) continue;
		if (line === 'BEGIN:VEVENT') {
			inVEvent = true;
			current = [];
		} else if (line === 'END:VEVENT') {
			if (inVEvent) vevents.push(current);
			inVEvent = false;
		} else if (inVEvent) {
			const p = parseLine(line);
			if (p) current.push(p);
		}
	}
	return vevents;
}

/**
 * Convert a list of parsed property lines into a RawVEvent.
 * Returns null if mandatory fields (UID, DTSTART) are missing.
 */
function propsToRawEvent(props: ParsedLine[]): RawVEvent | null {
	const get = (name: string) => props.find(p => p.name === name);
	const getAll = (name: string) => props.filter(p => p.name === name);

	const uidProp = get('UID');
	const dtstartProp = get('DTSTART');
	if (!uidProp || !dtstartProp) return null;

	const { date: startDate, isAllDay } = parseICSDate(dtstartProp.value);

	// Determine end date
	let endDate: Date;
	const dtendProp = get('DTEND');
	const durationProp = get('DURATION');
	if (dtendProp) {
		endDate = parseICSDate(dtendProp.value).date;
	} else if (durationProp) {
		endDate = addDuration(startDate, durationProp.value);
	} else {
		endDate = new Date(startDate);
		if (isAllDay) endDate.setDate(endDate.getDate() + 1);
		else endDate.setHours(endDate.getHours() + 1);
	}

	// EXDATE (may be a comma-separated list per property or multiple properties)
	const exdates: Date[] = getAll('EXDATE').flatMap(p =>
		p.value.split(',').map(v => parseICSDate(v.trim()).date),
	);

	// Attendees
	const attendees: AttendeeInfo[] = getAll('ATTENDEE').map(a => ({
		email: a.value.replace(/^mailto:/i, ''),
		name: a.params.CN,
		role: a.params.ROLE,
	}));

	// Organizer
	const orgProp = get('ORGANIZER');
	const organizerEmail = orgProp ? orgProp.value.replace(/^mailto:/i, '') : undefined;
	const organizerName = orgProp?.params.CN;

	return {
		uid: unescapeText(uidProp.value),
		title: unescapeText(get('SUMMARY')?.value ?? '(No Title)'),
		description: unescapeText(get('DESCRIPTION')?.value ?? ''),
		location: unescapeText(get('LOCATION')?.value ?? ''),
		startDate,
		endDate,
		isAllDay,
		rrule: get('RRULE')?.value,
		exdates,
		attendees,
		organizerEmail,
		organizerName,
	};
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * For all-day events, compare by local calendar date components.
 * For timed events, compare by timestamp.
 * This avoids timezone-offset mismatches where local midnight < UTC midnight.
 */
function eventInRange(startDate: Date, isAllDay: boolean, from: Date, to: Date): boolean {
	if (isAllDay) {
		// Extract local date components for an offset-agnostic comparison
		const sy = startDate.getFullYear(), sm = startDate.getMonth(), sd = startDate.getDate();
		const fy = from.getFullYear(), fm = from.getMonth(), fd = from.getDate();
		const ty = to.getFullYear(), tm = to.getMonth(), td = to.getDate();
		const startNum = sy * 10000 + sm * 100 + sd;
		const fromNum = fy * 10000 + fm * 100 + fd;
		const toNum   = ty * 10000 + tm * 100 + td;
		return startNum >= fromNum && startNum <= toNum;
	}
	return startDate >= from && startDate <= to;
}

/**
 * Parse raw ICS text and return all events (including recurring expansions)
 * whose start date falls within [from, to].
 */
export function parseAndFilterEvents(
	icsData: string,
	from: Date,
	to: Date,
): ParsedICSEvent[] {
	const lines = unfoldLines(icsData);
	const rawEvents = extractVEventProps(lines)
		.map(propsToRawEvent)
		.filter((e): e is RawVEvent => e !== null);

	const result: ParsedICSEvent[] = [];

	for (const raw of rawEvents) {
		if (raw.rrule) {
			const rrule = parseRRule(raw.rrule);
			if (!rrule) {
				// Unparseable RRULE — include only the base occurrence if in range
					if (eventInRange(raw.startDate, raw.isAllDay, from, to)) {
					result.push(rawToPublic(raw, raw.startDate, raw.endDate, true));
				}
				continue;
			}

			const occurrences = expandRRule(raw.startDate, rrule, raw.exdates, from, to);
			const durationMs = raw.endDate.getTime() - raw.startDate.getTime();
			for (const startDate of occurrences) {
				const endDate = new Date(startDate.getTime() + durationMs);
				result.push(rawToPublic(raw, startDate, endDate, true));
			}
		} else {
			if (eventInRange(raw.startDate, raw.isAllDay, from, to)) {
				result.push(rawToPublic(raw, raw.startDate, raw.endDate, false));
			}
		}
	}

	return result;
}

function rawToPublic(
	raw: RawVEvent,
	startDate: Date,
	endDate: Date,
	isRecurring: boolean,
): ParsedICSEvent {
	return {
		uid: raw.uid,
		title: raw.title,
		description: raw.description,
		location: raw.location,
		startDate,
		endDate,
		isAllDay: raw.isAllDay,
		isRecurring,
		attendees: raw.attendees,
		organizerEmail: raw.organizerEmail,
		organizerName: raw.organizerName,
	};
}
