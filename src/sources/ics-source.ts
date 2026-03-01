/**
 * ICS (iCalendar) source adapter for Calendar Bridge.
 *
 * Supports both public and secret ICS feeds.
 * Implements conditional GET (ETag / Last-Modified) for efficient polling.
 */

import { requestUrl } from 'obsidian';
import { AttendeeInfo, IcsCacheEntry, NormalizedEvent, SourceType } from '../types';
import { parseAndFilterEvents, ParsedICSEvent, extractMeetingLinks } from '../ics-parser';
import { CalendarSourceAdapter, SourceCapabilities, computeSeriesKey } from './adapter';

// ─── ICS Source Adapter ───────────────────────────────────────────────────────

export class IcsSourceAdapter implements CalendarSourceAdapter {
	readonly id: string;
	readonly name: string;
	readonly sourceType: SourceType;
	readonly capabilities: SourceCapabilities = {
		attendees: false,  // ICS attendees are best-effort
		conference: false,
		incremental: false,
	};

	private icsUrl: string;
	private cacheEntry: IcsCacheEntry;

	constructor(opts: {
		id: string;
		name: string;
		sourceType: SourceType;
		url: string;
		cacheEntry?: IcsCacheEntry;
	}) {
		this.id = opts.id;
		this.name = opts.name;
		this.sourceType = opts.sourceType;
		this.icsUrl = opts.url;
		this.cacheEntry = opts.cacheEntry ?? { url: opts.url };
	}

	async testConnection(): Promise<{ ok: boolean; message: string }> {
		try {
			const icsData = await this.fetchIcs();
			if (!icsData.includes('BEGIN:VCALENDAR')) {
				return { ok: false, message: 'URL does not appear to be a valid ICS feed' };
			}
			return { ok: true, message: 'Connected successfully' };
		} catch (err) {
			return { ok: false, message: (err as Error).message };
		}
	}

	async listCalendars(): Promise<Array<{ id: string; name: string }>> {
		// ICS feeds represent a single calendar
		return [{ id: this.id, name: this.name }];
	}

	async listEvents(
		_calendarId: string,
		timeMin: Date,
		timeMax: Date,
	): Promise<NormalizedEvent[]> {
		const icsData = await this.fetchIcs();
		const parsed = parseAndFilterEvents(icsData, timeMin, timeMax);
		return parsed.map(e => this.toNormalized(e));
	}

	/** Updated cache entry after the last fetch (for persistence). */
	getUpdatedCacheEntry(): IcsCacheEntry {
		return { ...this.cacheEntry };
	}

	// ─── Private helpers ──────────────────────────────────────────────────────

	private async fetchIcs(): Promise<string> {
		// Build headers for conditional GET
		const headers: Record<string, string> = {
			'Accept': 'text/calendar, */*',
		};
		if (this.cacheEntry.etag) {
			headers['If-None-Match'] = this.cacheEntry.etag;
		}
		if (this.cacheEntry.lastModified) {
			headers['If-Modified-Since'] = this.cacheEntry.lastModified;
		}

		const response = await requestUrl({
			url: this.icsUrl,
			method: 'GET',
			headers,
		});

		if (response.status === 304) {
			// Not modified — caller should use cached content
			// For simplicity in v1, just refetch without conditions
			const fresh = await requestUrl({ url: this.icsUrl, method: 'GET' });
			this.updateCacheHeaders(fresh.headers ?? {});
			return fresh.text;
		}

		this.updateCacheHeaders(response.headers ?? {});
		return response.text;
	}

	private updateCacheHeaders(headers: Record<string, string>): void {
		const etag = headers['etag'] ?? headers['ETag'];
		const lm = headers['last-modified'] ?? headers['Last-Modified'];
		if (etag) this.cacheEntry.etag = etag;
		if (lm) this.cacheEntry.lastModified = lm;
		this.cacheEntry.lastFetched = new Date().toISOString();
	}

	private toNormalized(e: ParsedICSEvent): NormalizedEvent {
		const seriesKey = computeSeriesKey({
			uid: e.uid,
			eventId: e.uid,
			isRecurring: e.isRecurring,
		});

		// Best-effort conference URL + Teams URL from free-text description + location
		const freeText = [e.location, e.description].filter(Boolean).join(' ');
		const extracted = freeText ? extractMeetingLinks(freeText) : {};
		const meetingUrl = extracted.meetingUrl;

		// Determine timezone — ICS doesn't give us the TZID easily here,
		// but we preserve it as empty to let rendering fall back to default
		const start = e.isAllDay
			? localDateToIso(e.startDate)
			: e.startDate.toISOString();
		const end = e.isAllDay
			? localDateToIso(e.endDate)
			: e.endDate.toISOString();

		const attendees: AttendeeInfo[] = e.attendees.map(a => ({
			email: a.email,
			name: a.name,
			role: a.role,
			optional: a.role === 'OPT-PARTICIPANT',
		}));

		const organizer = e.organizerName
			? `${e.organizerName} <${e.organizerEmail ?? ''}>`
			: e.organizerEmail;

		return {
			source: this.sourceType,
			calendarId: this.id,
			eventId: e.uid,
			uid: e.uid,
			title: e.title,
			start,
			end,
			startDate: e.startDate,
			endDate: e.endDate,
			isAllDay: e.isAllDay,
			status: 'confirmed',  // ICS doesn't consistently expose TRANSP/STATUS
			seriesKey,
			isRecurring: e.isRecurring,
			description: e.description || undefined,
			location: e.location || undefined,
			meetingUrl,
			attendees: attendees.length > 0 ? attendees : undefined,
			organizer,
			sourceName: this.name,
		};
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract a conference/meeting URL from a string (Meet, Zoom, Teams, Webex). */
export function extractConferenceUrl(text: string): string | null {
	const patterns = [
		/https:\/\/meet\.google\.com\/[a-z0-9-]+/i,
		/https:\/\/[a-z0-9-]+\.zoom\.us\/[^\s"']*/i,
		/https:\/\/teams\.microsoft\.com\/[^\s"']*/i,
		/https:\/\/[a-z0-9]+\.webex\.com\/[^\s"']*/i,
	];
	for (const re of patterns) {
		const m = text.match(re);
		if (m) return m[0];
	}
	return null;
}

/** Format a local Date as YYYY-MM-DD (for all-day events). */
function localDateToIso(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
