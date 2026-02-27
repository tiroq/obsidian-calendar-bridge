// ─── Source types ─────────────────────────────────────────────────────────────

export type SourceType = 'gcal_api' | 'ics_public' | 'ics_secret';

export type EventStatus = 'confirmed' | 'cancelled' | 'tentative' | 'unknown';

// ─── Attendee ─────────────────────────────────────────────────────────────────

export interface AttendeeInfo {
	email: string;
	name?: string;
	/** e.g. "REQ-PARTICIPANT", "OPT-PARTICIPANT", "CHAIR" */
	role?: string;
	optional?: boolean;
	responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

// ─── Normalized event (internal canonical form) ───────────────────────────────

/**
 * All calendar sources normalize to this shape before reaching the sync engine.
 * The note generator works exclusively with NormalizedEvent.
 */
export interface NormalizedEvent {
	// Required
	source: SourceType;
	calendarId: string;
	eventId: string;          // source-specific ID
	uid: string;              // iCal UID (or derived)
	title: string;
	start: string;            // ISO 8601 with TZ offset
	end: string;              // ISO 8601 with TZ offset
	startDate: Date;          // parsed Date object (for sorting / range checks)
	endDate: Date;            // parsed Date object
	isAllDay: boolean;
	status: EventStatus;
	seriesKey: string;        // stable series identifier (see doc 02)
	isRecurring: boolean;

	// Optional
	updatedAt?: string;
	description?: string;
	location?: string;
	conferenceUrl?: string;
	teamsUrl?: string;         // Microsoft Teams join link (if found)
	meetingUrl?: string;       // Best join link (Meet > Zoom > Teams > other)
	attendees?: AttendeeInfo[];
	organizer?: string;       // "Name <email>" or just email
	sourceName: string;       // display name of the calendar
	recurringEventId?: string; // Google's recurringEventId (for seriesKey)
	timezone?: string;        // TZID from VEVENT or event timezone
}

// ─── Rich calendar item (panel calendar list) ──────────────────────────────────

/**
 * Extended calendar metadata returned by the Google calendarList endpoint.
 * Used by the control panel to show color dots, access role badges, timezone.
 */
export interface RichCalendarItem {
	id: string;
	name: string;
	colorId?: string;
	backgroundColor?: string;
	foregroundColor?: string;
	accessRole?: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
	timeZone?: string;
	primary?: boolean;
	/** Whether the user has this calendar selected in Google Calendar UI. */
	selected?: boolean;
	description?: string;
}

// ─── Series ───────────────────────────────────────────────────────────────────

/**
 * User-configurable profile for a meeting series.
 * Stored in subscriptions.json alongside enabled/disabled state.
 */
export interface SeriesProfile {
	seriesKey: string;
	seriesName: string;
	enabled: boolean;
	noteFolderOverride?: string;
	templateOverride?: string;
	defaultAgenda?: string;   // markdown text
	tags?: string[];
	pinnedAttendees?: string[];  // emails always included
	hiddenAttendees?: string[];  // emails never shown
}

// ─── Subscriptions state (persisted to subscriptions.json) ───────────────────

export interface SubscriptionsState {
	version: number;
	profiles: Record<string, SeriesProfile>; // keyed by seriesKey
}

// ─── Sync progress ────────────────────────────────────────────────────────────

export type SyncStage =
	| 'authenticating'
	| 'fetching-calendars'
	| 'fetching-events'
	| 'applying-filters'
	| 'writing-notes'
	| 'completed';

// ─── ICS cache entry (persisted to cache.json) ────────────────────────────────

export interface IcsCacheEntry {
	url: string;
	etag?: string;
	lastModified?: string;
	lastFetched?: string;
}

export interface SyncCache {
	version: number;
	lastSyncAt?: string;
	icsCache: Record<string, IcsCacheEntry>; // keyed by source id
	/** eventId/uid → vault path mapping for conflict resolution */
	eventToPath: Record<string, string>;
}

// ─── Settings (global) ────────────────────────────────────────────────────────

export interface GoogleApiSettings {
	/** OAuth 2.0 Client ID from Google Cloud Console (Desktop app type) */
	clientId: string;
	/**
	 * Client type detected from the downloaded credentials JSON.
	 * 'installed' = Desktop app (no secret required for PKCE).
	 * 'web' = Web application (secret required).
	 */
	googleClientType?: 'installed' | 'web';
	/**
	 * client_secret from credentials JSON — included in token exchange only when present.
	 * Desktop app clients omit this; web clients require it.
	 */
	googleClientSecret?: string;
	/** File name of the last loaded credentials JSON (display only). */
	googleCredsFileName?: string;
	/** Stored access token */
	accessToken?: string;
	refreshToken?: string;
	tokenExpiry?: number;
	selectedCalendarIds: string[];
	includeConferenceData: boolean;
}

export interface IcsSourceSettings {
	/** Public or secret ICS URL */
	url: string;
	pollIntervalMinutes: number;
}

export interface CalendarSourceConfig {
	id: string;
	name: string;
	sourceType: SourceType;
	enabled: boolean;
	google?: GoogleApiSettings;
	ics?: IcsSourceSettings;
}

export interface PluginSettings {
	// Source config
	sources: CalendarSourceConfig[];

	// Sync
	horizonDays: number;
	autoSyncIntervalMinutes: number;  // 0 = off
	syncOnStartup: boolean;

	// Paths
	meetingsRoot: string;
	seriesRoot: string;
	templatePath: string;

	// Features
	enableSeriesPages: boolean;
	enablePrevNextLinks: boolean;
	writeStateInVault: boolean;

	// Format
	dateFolderFormat: string;
	fileNameFormat: string;       // e.g. "{time} [{series}] {title}"
	timezoneDefault: string;      // empty = use system
	dateFormat: string;
	timeFormat: string;

	// Privacy
	redactionMode: boolean;       // do not write attendees/links

	// Internal
	lastSyncTime?: string;
	stateVersion: number;

	// Panel filter settings
	panelHorizonDays: number;
	panelIncludeAllDay: boolean;
	panelIncludeDeclined: boolean;
	panelOnlyWithAttendees: boolean;
	panelSkipShorterThanMin: number;  // 0 = disabled
	panelExtractConferenceLinks: boolean;
	panelExtractAttendees: boolean;
	panelExtractLocation: boolean;
	panelExcludeTitles: string;       // comma-separated keywords
	panelIncludeTitles: string;       // comma-separated keywords
	panelTitleRegexMode: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	sources: [],
	horizonDays: 3,
	autoSyncIntervalMinutes: 60,
	syncOnStartup: true,
	meetingsRoot: 'Meetings',
	seriesRoot: 'Meetings/_series',
	templatePath: '',
	enableSeriesPages: true,
	enablePrevNextLinks: true,
	writeStateInVault: false,
	dateFolderFormat: 'YYYY-MM-DD',
	fileNameFormat: '{time} [{series}] {title}',
	timezoneDefault: '',
	dateFormat: 'YYYY-MM-DD',
	timeFormat: 'HH:mm',
	redactionMode: false,
	stateVersion: 1,
	// Panel filter defaults
	panelHorizonDays: 5,
	panelIncludeAllDay: true,
	panelIncludeDeclined: false,
	panelOnlyWithAttendees: false,
	panelSkipShorterThanMin: 0,
	panelExtractConferenceLinks: true,
	panelExtractAttendees: true,
	panelExtractLocation: true,
	panelExcludeTitles: '',
	panelIncludeTitles: '',
	panelTitleRegexMode: false,
};

// ─── Legacy compat shim (kept so existing tests import still work) ────────────

/** @deprecated Use CalendarSourceConfig instead */
export interface CalendarSource {
	id: string;
	name: string;
	url: string;
	enabled: boolean;
}

/** @deprecated Use NormalizedEvent instead */
export interface CalendarEvent {
	uid: string;
	title: string;
	description: string;
	location: string;
	startDate: Date;
	endDate: Date;
	isAllDay: boolean;
	isRecurring: boolean;
	attendees: AttendeeInfo[];
	organizer?: string;
	sourceId: string;
	sourceName: string;
}
