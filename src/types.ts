// ─── Calendar Source ──────────────────────────────────────────────────────────

export interface CalendarSource {
	/** Unique identifier for this source */
	id: string;
	/** Display name shown in settings and note metadata */
	name: string;
	/** Google Calendar ICS export URL or any .ics feed URL */
	url: string;
	/** Whether this source is included in syncs */
	enabled: boolean;
}

// ─── Event data ───────────────────────────────────────────────────────────────

export interface AttendeeInfo {
	email: string;
	name?: string;
	/** e.g. "REQ-PARTICIPANT", "OPT-PARTICIPANT", "CHAIR" */
	role?: string;
}

export interface CalendarEvent {
	/** RFC 5545 UID.  All instances of a recurring series share the same UID. */
	uid: string;
	title: string;
	description: string;
	location: string;
	startDate: Date;
	endDate: Date;
	isAllDay: boolean;
	/** True when this event is an instance of a recurring series. */
	isRecurring: boolean;
	attendees: AttendeeInfo[];
	/** Formatted organizer string, e.g. "Alice <alice@example.com>" */
	organizer?: string;
	/** ID of the CalendarSource this event came from */
	sourceId: string;
	/** Display name of the CalendarSource this event came from */
	sourceName: string;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface PluginSettings {
	calendarSources: CalendarSource[];
	/** Vault path for individual meeting notes */
	notesFolder: string;
	/** Vault path for recurring-series index pages */
	seriesFolder: string;
	/** Vault path to a custom template note (empty → built-in template) */
	templatePath: string;
	/** How many calendar days ahead to sync */
	syncHorizonDays: number;
	/** Trigger a sync automatically when Obsidian starts */
	syncOnStartup: boolean;
	/** Date format tokens: YYYY MM DD */
	dateFormat: string;
	/** Time format tokens: HH mm */
	timeFormat: string;
	/** ISO timestamp of the last successful sync (informational) */
	lastSyncTime?: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	calendarSources: [],
	notesFolder: 'Meetings',
	seriesFolder: 'Meetings/Series',
	templatePath: '',
	syncHorizonDays: 14,
	syncOnStartup: true,
	dateFormat: 'YYYY-MM-DD',
	timeFormat: 'HH:mm',
};
