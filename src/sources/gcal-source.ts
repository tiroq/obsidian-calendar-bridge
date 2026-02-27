/**
 * Google Calendar API (OAuth 2.0) source adapter for Calendar Bridge.
 *
 * Uses PKCE-style Authorization Code flow with local redirect.
 * Tokens are stored in plugin settings (users are warned about this).
 *
 * API reference: https://developers.google.com/calendar/api/v3/reference
 */

import { requestUrl } from 'obsidian';
import { extractMeetingLinks } from '../ics-parser';
import {
	AttendeeInfo,
	EventStatus,
	GoogleApiSettings,
	NormalizedEvent,
	RichCalendarItem,
} from '../types';
import { CalendarSourceAdapter, SourceCapabilities, computeSeriesKey } from './adapter';

// ─── Google API types ─────────────────────────────────────────────────────────

interface GCalEvent {
	id: string;
	status: string;
	summary?: string;
	description?: string;
	location?: string;
	start: { dateTime?: string; date?: string; timeZone?: string };
	end: { dateTime?: string; date?: string; timeZone?: string };
	recurringEventId?: string;
	iCalUID?: string;
	updated?: string;
	organizer?: { email?: string; displayName?: string };
	attendees?: Array<{
		email: string;
		displayName?: string;
		optional?: boolean;
		responseStatus?: string;
		self?: boolean;
	}>;
	conferenceData?: {
		entryPoints?: Array<{ entryPointType: string; uri: string }>;
	};
}

interface GCalListResponse {
	items?: GCalEvent[];
	nextPageToken?: string;
}

interface GCalCalendar {
	id: string;
	summary: string;
	colorId?: string;
	backgroundColor?: string;
	foregroundColor?: string;
	accessRole?: string;
	timeZone?: string;
	primary?: boolean;
	selected?: boolean;
	description?: string;
}

interface GCalCalendarListResponse {
	items?: GCalCalendar[];
	nextPageToken?: string;
}

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	token_type: string;
}

// ─── OAuth helpers ────────────────────────────────────────────────────────────

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI_LOOPBACK = (port: number) => `http://127.0.0.1:${port}/callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function base64urlEncode(buf: Uint8Array): string {
	let str = '';
	for (let i = 0; i < buf.length; i++) str += String.fromCharCode(buf[i]);
	return btoa(str)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');
}

/** Generate a PKCE code_verifier (96 random bytes → 128-char base64url string). */
function generateCodeVerifier(): string {
	const arr = new Uint8Array(96);
	crypto.getRandomValues(arr);
	return base64urlEncode(arr);
}

/** Derive the PKCE code_challenge = BASE64URL(SHA-256(verifier)). */
async function generateCodeChallenge(verifier: string): Promise<string> {
	const data = new TextEncoder().encode(verifier);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return base64urlEncode(new Uint8Array(digest));
}
// ─── Google Source Adapter ────────────────────────────────────────────────────

export class GoogleCalendarAdapter implements CalendarSourceAdapter {
	readonly id: string;
	readonly name: string;
	readonly sourceType = 'gcal_api' as const;
	readonly capabilities: SourceCapabilities = {
		attendees: true,
		conference: true,
		incremental: false,
	};

	private settings: GoogleApiSettings;
	private onSettingsUpdate: (updated: GoogleApiSettings) => Promise<void>;
	/** Pending PKCE code_verifier for the in-flight authorization request. */
	private pendingCodeVerifier?: string;

	constructor(opts: {
		id: string;
		name: string;
		settings: GoogleApiSettings;
		onSettingsUpdate: (updated: GoogleApiSettings) => Promise<void>;
	}) {
		this.id = opts.id;
		this.name = opts.name;
		this.settings = { ...opts.settings };
		this.onSettingsUpdate = opts.onSettingsUpdate;
	}

	// ─── Connection test ─────────────────────────────────────────────────────

	async testConnection(): Promise<{ ok: boolean; message: string }> {
		try {
			await this.ensureValidToken();
			const cals = await this.listCalendars();
			return {
				ok: true,
				message: `Connected. Found ${cals.length} calendar(s).`,
			};
		} catch (err) {
			return { ok: false, message: (err as Error).message };
		}
	}

	// ─── Calendar list ───────────────────────────────────────────────────────

	async listCalendars(): Promise<RichCalendarItem[]> {
		await this.ensureValidToken();
		const items: RichCalendarItem[] = [];
		let pageToken: string | undefined;

		do {
			const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
			url.searchParams.set('maxResults', '250');
			if (pageToken) url.searchParams.set('pageToken', pageToken);

			const resp = await requestUrl({
				url: url.toString(),
				headers: { Authorization: `Bearer ${this.settings.accessToken}` },
			});
			const data = resp.json as GCalCalendarListResponse;
			for (const cal of data.items ?? []) {
				items.push({
					id: cal.id,
					name: cal.summary ?? cal.id,
					colorId: cal.colorId,
					backgroundColor: cal.backgroundColor,
					foregroundColor: cal.foregroundColor,
					accessRole: cal.accessRole as RichCalendarItem['accessRole'],
					timeZone: cal.timeZone,
					primary: cal.primary,
					selected: cal.selected,
					description: cal.description,
				});
			}
			pageToken = data.nextPageToken;
		} while (pageToken);

		return items;
	}

	// ─── Event listing ───────────────────────────────────────────────────────

	async listEvents(
		calendarId: string,
		timeMin: Date,
		timeMax: Date,
	): Promise<NormalizedEvent[]> {
		await this.ensureValidToken();
		const events: NormalizedEvent[] = [];
		let pageToken: string | undefined;

		do {
			const url = new URL(
				`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
			);
			url.searchParams.set('timeMin', timeMin.toISOString());
			url.searchParams.set('timeMax', timeMax.toISOString());
			url.searchParams.set('singleEvents', 'true');
			url.searchParams.set('orderBy', 'startTime');
			url.searchParams.set('maxResults', '250');
			if (this.settings.includeConferenceData) {
				url.searchParams.set('conferenceDataVersion', '1');
			}
			if (pageToken) url.searchParams.set('pageToken', pageToken);

			const resp = await requestUrl({
				url: url.toString(),
				headers: { Authorization: `Bearer ${this.settings.accessToken}` },
			});

			if (resp.status === 401) {
				throw new Error('Google API: unauthorized. Please re-authenticate in settings.');
			}
			if (resp.status >= 400) {
				throw new Error(`Google API error ${resp.status}`);
			}

			const data = resp.json as GCalListResponse;
			for (const item of data.items ?? []) {
				const normalized = this.toNormalized(item, calendarId);
				if (normalized) events.push(normalized);
			}
			pageToken = data.nextPageToken;
		} while (pageToken);

		return events;
	}

	// ─── OAuth flow ──────────────────────────────────────────────────────────

	/**
	 * Async version that generates the PKCE challenge and returns the auth URL.
	 */
	async getAuthorizationUrlAsync(port: number): Promise<string> {
		const verifier = generateCodeVerifier();
		this.pendingCodeVerifier = verifier;
		const challenge = await generateCodeChallenge(verifier);

		const url = new URL(AUTH_URL);
		url.searchParams.set('client_id', this.settings.clientId);
		url.searchParams.set('redirect_uri', REDIRECT_URI_LOOPBACK(port));
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('scope', SCOPES.join(' '));
		url.searchParams.set('access_type', 'offline');
		url.searchParams.set('prompt', 'select_account consent');
		url.searchParams.set('code_challenge', challenge);
		url.searchParams.set('code_challenge_method', 'S256');
		console.log('[CalendarBridge] PKCE verifier length:', verifier.length, '| challenge:', challenge);
		console.log('[CalendarBridge] Full auth URL:', url.toString());
		return url.toString();
	}

	/**
	 * Exchange an authorization code for tokens using PKCE (no client_secret for Desktop app clients).
	 */
	async exchangeCodeForTokens(code: string, port: number): Promise<void> {
		if (!this.pendingCodeVerifier) {
			throw new Error('No pending PKCE verifier. Call getAuthorizationUrlAsync() first.');
		}
		const verifier = this.pendingCodeVerifier;
		this.pendingCodeVerifier = undefined;

		const body = new URLSearchParams({
			code,
			client_id: this.settings.clientId,
			code_verifier: verifier,
			redirect_uri: REDIRECT_URI_LOOPBACK(port),
			grant_type: 'authorization_code',
		});
		// Include client_secret only when present (Web app clients or explicit secret flows).
		// Desktop app clients using PKCE must NOT send client_secret.
		if (this.settings.googleClientSecret) {
			body.set('client_secret', this.settings.googleClientSecret);
		}

		const bodyStr = body.toString();
		const requestHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
		console.log('[CalendarBridge] Token exchange body:', bodyStr);
		console.log('[CalendarBridge] Token exchange headers:', JSON.stringify(requestHeaders));
		let resp: { status: number; text: string; json: unknown };
		try {
			resp = await requestUrl({
				url: TOKEN_URL,
				method: 'POST',
				headers: requestHeaders,
				body: bodyStr,
				throw: false,
			});
		} catch (err) {
			throw new Error(`Token exchange network error: ${(err as Error).message}`);
		}
		if (resp.status !== 200) {
			console.error('[CalendarBridge] Token exchange failed', resp.status, resp.text);
			// Detect Web application client misuse: Google returns this when client_secret is
			// required but absent, which happens exclusively with Web app clients.
			// Desktop app clients use PKCE and never require client_secret.
			let errorBody: { error?: string; error_description?: string } = {};
			try { errorBody = JSON.parse(resp.text); } catch { /* ignore */ }
			if (
				errorBody.error_description?.includes('client_secret is missing') ||
				errorBody.error === 'unauthorized_client'
			) {
				throw new Error(
					'Token exchange rejected: your Client ID is a Web application client, not a Desktop app client. ' +
					'In Google Cloud Console go to APIs & Services \u2192 Credentials, ' +
					'create a new OAuth 2.0 Client ID with Application type "Desktop app", and use that Client ID instead.',
				);
			}
			throw new Error(`Token exchange failed (${resp.status}): ${resp.text}`);
		}

		const tokens = resp.json as TokenResponse;
		this.settings.accessToken = tokens.access_token;
		if (tokens.refresh_token) {
			this.settings.refreshToken = tokens.refresh_token;
		}
		this.settings.tokenExpiry = Date.now() + (tokens.expires_in - 60) * 1000;
		await this.onSettingsUpdate({ ...this.settings });
	}

	/**
	 * Revoke tokens and clear stored credentials.
	 */
	async disconnect(): Promise<void> {
		if (this.settings.accessToken) {
			try {
				await requestUrl({
					url: `https://oauth2.googleapis.com/revoke?token=${this.settings.accessToken}`,
					method: 'POST',
				});
			} catch {
				// Best-effort; clear local tokens regardless
			}
		}
		this.settings.accessToken = undefined;
		this.settings.refreshToken = undefined;
		this.settings.tokenExpiry = undefined;
		await this.onSettingsUpdate({ ...this.settings });
	}

	// ─── Private helpers ──────────────────────────────────────────────────────

	private async ensureValidToken(): Promise<void> {
		if (!this.settings.accessToken) {
			throw new Error(
				'Google Calendar not authenticated. Open Settings → Calendar Bridge to connect.',
			);
		}

		const isExpired = this.settings.tokenExpiry
			? Date.now() >= this.settings.tokenExpiry
			: false;

		if (isExpired && this.settings.refreshToken) {
			await this.refreshAccessToken();
		}
	}

	private async refreshAccessToken(): Promise<void> {
		const body = new URLSearchParams({
			client_id: this.settings.clientId,
			refresh_token: this.settings.refreshToken!,
			grant_type: 'refresh_token',
		});
		// Include client_secret only when present
		if (this.settings.googleClientSecret) {
			body.set('client_secret', this.settings.googleClientSecret);
		}

		const resp = await requestUrl({
			url: TOKEN_URL,
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		});

		if (resp.status !== 200) {
			this.settings.accessToken = undefined;
			this.settings.tokenExpiry = undefined;
			await this.onSettingsUpdate({ ...this.settings });
			throw new Error('Google token refresh failed. Please re-authenticate.');
		}

		const tokens = resp.json as TokenResponse;
		this.settings.accessToken = tokens.access_token;
		this.settings.tokenExpiry = Date.now() + (tokens.expires_in - 60) * 1000;
		await this.onSettingsUpdate({ ...this.settings });
	}

	private toNormalized(item: GCalEvent, calendarId: string): NormalizedEvent | null {
		const isAllDay = !!item.start.date && !item.start.dateTime;
		const startStr = item.start.dateTime ?? item.start.date ?? '';
		const endStr = item.end.dateTime ?? item.end.date ?? '';

		if (!startStr) return null;

		const startDate = new Date(startStr);
		const endDate = endStr ? new Date(endStr) : new Date(startDate.getTime() + 3600000);

		const status: EventStatus = (() => {
			switch (item.status) {
				case 'cancelled': return 'cancelled';
				case 'tentative': return 'tentative';
				case 'confirmed': return 'confirmed';
				default: return 'unknown';
			}
		})();

		const isRecurring = !!item.recurringEventId;
		const uid = item.iCalUID ?? item.id;
		const seriesKey = computeSeriesKey({
			recurringEventId: item.recurringEventId,
			uid,
			eventId: item.id,
			isRecurring,
		});

		// Conference URL from Google conferenceData (prefer video entry = Meet/Zoom)
		let conferenceUrl: string | undefined;
		if (item.conferenceData?.entryPoints) {
			const video = item.conferenceData.entryPoints.find(
				ep => ep.entryPointType === 'video',
			);
			conferenceUrl = (video ?? item.conferenceData.entryPoints[0])?.uri;
		}

		// Extract Teams/Zoom/Meet links from free-text description + location
		const freeText = [item.description, item.location].filter(Boolean).join(' ');
		const extracted = freeText ? extractMeetingLinks(freeText) : {};
		// teamsUrl: from description/location
		const teamsUrl = extracted.teamsUrl;
		// meetingUrl priority: conferenceData URL > extracted Meet/Zoom > Teams
		const meetingUrl = conferenceUrl ?? extracted.meetingUrl;

		// Attendees
		const attendees: AttendeeInfo[] = (item.attendees ?? [])
			.filter(a => !a.self)
			.map(a => ({
				email: a.email,
				name: a.displayName,
				optional: a.optional ?? false,
				responseStatus: a.responseStatus as AttendeeInfo['responseStatus'],
			}));

		// Organizer
		const organizer = item.organizer?.displayName
			? `${item.organizer.displayName} <${item.organizer.email ?? ''}>`
			: item.organizer?.email;

		return {
			source: 'gcal_api',
			calendarId,
			eventId: item.id,
			uid,
			title: item.summary ?? '(No Title)',
			start: startStr,
			end: endStr,
			startDate,
			endDate,
			isAllDay,
			status,
			seriesKey,
			isRecurring,
			updatedAt: item.updated,
			description: item.description || undefined,
			location: item.location || undefined,
			conferenceUrl: meetingUrl,   // backward compat — keeps existing tests green
			attendees: attendees.length > 0 ? attendees : undefined,
			teamsUrl,
			meetingUrl,
			organizer,
			sourceName: this.name,
			recurringEventId: item.recurringEventId,
			timezone: item.start.timeZone,
		};
	}
}
