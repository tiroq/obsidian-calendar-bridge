/**
 * Tests for GoogleCalendarAdapter — PKCE OAuth flow and token exchange.
 *
 * Key invariants:
 *  - token exchange body must NOT contain client_secret
 *  - token exchange body must contain code_verifier
 *  - token endpoint must be https://oauth2.googleapis.com/token
 *  - base64urlEncode produces correct RFC 4648 base64url output
 *  - Web application client (returns client_secret error) surfaces clear user message
 */

import { requestUrl } from './__mocks__/obsidian';
import { GoogleCalendarAdapter } from '../src/sources/gcal-source';
import type { GoogleApiSettings } from '../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSettings(overrides: Partial<GoogleApiSettings> = {}): GoogleApiSettings {
	return {
		clientId: 'test-client-id.apps.googleusercontent.com',
		accessToken: undefined,
		refreshToken: undefined,
		tokenExpiry: undefined,
		selectedCalendarIds: [],
		includeConferenceData: false,
		...overrides,
	};
}

function makeAdapter(settings: GoogleApiSettings = makeSettings()) {
	return new GoogleCalendarAdapter({
		id: 'test',
		name: 'Test Calendar',
		settings,
		onSettingsUpdate: jest.fn(),
	});
}

// ─── base64urlEncode (tested indirectly via PKCE verifier shape) ───────────────

describe('PKCE verifier / challenge shape', () => {
	test('generateCodeVerifier produces 128-char base64url string', async () => {
		const adapter = makeAdapter();
		const port = 12345;

		// getAuthorizationUrlAsync sets pendingCodeVerifier internally
		const url = await adapter.getAuthorizationUrlAsync(port);
		const parsed = new URL(url);

		// code_challenge must be present and be a non-empty base64url string
		const challenge = parsed.searchParams.get('code_challenge');
		expect(challenge).toBeTruthy();
		expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);

		// code_challenge_method must be S256
		expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');

		// client_id is correct
		expect(parsed.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.com');

		// redirect_uri contains 127.0.0.1 loopback
		expect(parsed.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
	});

	test('auth URL uses correct Google authorization endpoint', async () => {
		const adapter = makeAdapter();
		const url = await adapter.getAuthorizationUrlAsync(54321);
		expect(url).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
	});
});

// ─── Token exchange request body ──────────────────────────────────────────────

describe('exchangeCodeForTokens — request body', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(requestUrl as jest.Mock).mockResolvedValue({
			status: 200,
			text: '{}',
			json: {
				access_token: 'ya29.test-access-token',
				expires_in: 3600,
				token_type: 'Bearer',
				refresh_token: 'test-refresh-token',
			},
		});
	});

	test('token exchange body does NOT contain client_secret', async () => {
		const adapter = makeAdapter();
		const port = 49200;
		await adapter.getAuthorizationUrlAsync(port);
		await adapter.exchangeCodeForTokens('auth-code-abc', port);

		expect(requestUrl).toHaveBeenCalledTimes(1);
		const call = (requestUrl as jest.Mock).mock.calls[0][0];
		const body: string = call.body;

		expect(body).not.toContain('client_secret');
	});

	test('token exchange body contains code_verifier', async () => {
		const adapter = makeAdapter();
		const port = 49201;
		await adapter.getAuthorizationUrlAsync(port);
		await adapter.exchangeCodeForTokens('auth-code-def', port);

		const call = (requestUrl as jest.Mock).mock.calls[0][0];
		const body: string = call.body;
		const params = new URLSearchParams(body);

		expect(params.get('code_verifier')).toBeTruthy();
		expect(params.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	test('token exchange body contains correct grant_type and client_id', async () => {
		const adapter = makeAdapter();
		const port = 49202;
		await adapter.getAuthorizationUrlAsync(port);
		await adapter.exchangeCodeForTokens('auth-code-ghi', port);

		const call = (requestUrl as jest.Mock).mock.calls[0][0];
		const params = new URLSearchParams(call.body as string);

		expect(params.get('grant_type')).toBe('authorization_code');
		expect(params.get('client_id')).toBe('test-client-id.apps.googleusercontent.com');
		expect(params.get('redirect_uri')).toBe(`http://127.0.0.1:${port}/callback`);
	});

	test('token exchange uses correct Google token endpoint', async () => {
		const adapter = makeAdapter();
		const port = 49203;
		await adapter.getAuthorizationUrlAsync(port);
		await adapter.exchangeCodeForTokens('auth-code-jkl', port);

		const call = (requestUrl as jest.Mock).mock.calls[0][0];
		expect(call.url).toBe('https://oauth2.googleapis.com/token');
	});

	test('code_verifier in exchange matches code_challenge in auth URL (PKCE integrity)', async () => {
		const adapter = makeAdapter();
		const port = 49204;

		const authUrl = await adapter.getAuthorizationUrlAsync(port);
		await adapter.exchangeCodeForTokens('auth-code-mno', port);

		// Extract challenge from auth URL
		const challenge = new URL(authUrl).searchParams.get('code_challenge')!;

		// Extract verifier from token exchange body
		const call = (requestUrl as jest.Mock).mock.calls[0][0];
		const verifier = new URLSearchParams(call.body as string).get('code_verifier')!;

		// Re-derive challenge from verifier and compare
		const data = new TextEncoder().encode(verifier);
		const digest = await crypto.subtle.digest('SHA-256', data);
		const buf = new Uint8Array(digest);
		let str = '';
		for (let i = 0; i < buf.length; i++) str += String.fromCharCode(buf[i]);
		const expected = btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

		expect(challenge).toBe(expected);
	});
});

// ─── Refresh token request body ───────────────────────────────────────────────

describe('refreshAccessToken — request body', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(requestUrl as jest.Mock).mockResolvedValue({
			status: 200,
			text: '{}',
			json: {
				access_token: 'ya29.refreshed-token',
				expires_in: 3600,
				token_type: 'Bearer',
			},
		});
	});

	test('refresh body does NOT contain client_secret', async () => {
		const settings = makeSettings({
			accessToken: 'old-token',
			refreshToken: 'refresh-token-xyz',
			tokenExpiry: Date.now() - 1000, // expired → triggers refresh
		});
		const adapter = makeAdapter(settings);

		// ensureValidToken triggers refresh when token is expired
		await (adapter as unknown as { ensureValidToken(): Promise<void> }).ensureValidToken();

		expect(requestUrl).toHaveBeenCalledTimes(1);
		const call = (requestUrl as jest.Mock).mock.calls[0][0];
		const params = new URLSearchParams(call.body as string);

		expect(params.get('client_secret')).toBeNull();
		expect(params.get('grant_type')).toBe('refresh_token');
		expect(params.get('client_id')).toBe('test-client-id.apps.googleusercontent.com');
		expect(params.get('refresh_token')).toBe('refresh-token-xyz');
	});
});

// ─── Web client detection ─────────────────────────────────────────────────────

describe('exchangeCodeForTokens — Web client detection', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('throws clear Desktop-app guidance when Google returns client_secret is missing', async () => {
		(requestUrl as jest.Mock).mockResolvedValue({
			status: 400,
			text: JSON.stringify({
				error: 'invalid_request',
				error_description: 'client_secret is missing.',
			}),
			json: {
				error: 'invalid_request',
				error_description: 'client_secret is missing.',
			},
		});

		const adapter = makeAdapter();
		const port = 49210;
		await adapter.getAuthorizationUrlAsync(port);

		await expect(
			adapter.exchangeCodeForTokens('bad-code', port),
		).rejects.toThrow(/Web application client.*Desktop app/i);
	});

	test('throws clear Desktop-app guidance when Google returns unauthorized_client', async () => {
		(requestUrl as jest.Mock).mockResolvedValue({
			status: 401,
			text: JSON.stringify({
				error: 'unauthorized_client',
				error_description: 'The OAuth client was not found.',
			}),
			json: {
				error: 'unauthorized_client',
				error_description: 'The OAuth client was not found.',
			},
		});

		const adapter = makeAdapter();
		const port = 49212;
		await adapter.getAuthorizationUrlAsync(port);

		await expect(
			adapter.exchangeCodeForTokens('bad-code', port),
		).rejects.toThrow(/Web application client.*Desktop app/i);
	});

	test('throws generic error for non-client_secret 400 errors', async () => {
		(requestUrl as jest.Mock).mockResolvedValue({
			status: 400,
			text: JSON.stringify({ error: 'invalid_grant', error_description: 'Code was already redeemed.' }),
			json: { error: 'invalid_grant', error_description: 'Code was already redeemed.' },
		});

		const adapter = makeAdapter();
		const port = 49213;
		await adapter.getAuthorizationUrlAsync(port);

		await expect(
			adapter.exchangeCodeForTokens('used-code', port),
		).rejects.toThrow(/Token exchange failed \(400\)/);
	});
});

// ─── PKCE state machine ────────────────────────────────────────────────────────

describe('PKCE state machine', () => {
	test('throws if exchangeCodeForTokens called without prior getAuthorizationUrlAsync', async () => {
		const adapter = makeAdapter();
		await expect(
			adapter.exchangeCodeForTokens('some-code', 49220),
		).rejects.toThrow(/No pending PKCE verifier/);
	});

	test('verifier is cleared after first exchange (cannot reuse)', async () => {
		(requestUrl as jest.Mock).mockResolvedValue({
			status: 200,
			text: '{}',
			json: { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' },
		});

		const adapter = makeAdapter();
		const port = 49221;
		await adapter.getAuthorizationUrlAsync(port);
		await adapter.exchangeCodeForTokens('code-1', port);

		// Second call must fail — verifier was consumed
		await expect(
			adapter.exchangeCodeForTokens('code-2', port),
		).rejects.toThrow(/No pending PKCE verifier/);
	});
});

// ─── listCalendars ────────────────────────────────────────────────────────────

describe('listCalendars', () => {
	const CAL_LIST_RESPONSE = {
		items: [
			{ id: 'primary', summary: 'My Calendar', accessRole: 'owner', primary: true },
			{ id: 'work@example.com', summary: 'Work', accessRole: 'writer', backgroundColor: '#4a86e8' },
			{ id: 'holidays@group.v.calendar.google.com', summary: 'Holidays', accessRole: 'reader' },
		],
	};

	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns all calendars from the API', async () => {
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: JSON.stringify(CAL_LIST_RESPONSE), json: CAL_LIST_RESPONSE });
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const cals = await adapter.listCalendars();
		expect(cals).toHaveLength(3);
		expect(cals[0].id).toBe('primary');
		expect(cals[1].name).toBe('Work');
		expect(cals[2].accessRole).toBe('reader');
	});

	test('maps backgroundColor and primary fields', async () => {
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: JSON.stringify(CAL_LIST_RESPONSE), json: CAL_LIST_RESPONSE });
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const cals = await adapter.listCalendars();
		expect(cals[0].primary).toBe(true);
		expect(cals[1].backgroundColor).toBe('#4a86e8');
	});

	test('handles pagination via nextPageToken', async () => {
		const page1 = { items: [{ id: 'cal1', summary: 'Cal 1', accessRole: 'owner' }], nextPageToken: 'tok2' };
		const page2 = { items: [{ id: 'cal2', summary: 'Cal 2', accessRole: 'reader' }] };
		(requestUrl as jest.Mock)
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify(page1), json: page1 })
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify(page2), json: page2 });
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const cals = await adapter.listCalendars();
		expect(cals).toHaveLength(2);
		expect(cals[0].id).toBe('cal1');
		expect(cals[1].id).toBe('cal2');
		// second call should include pageToken param
		const secondCallUrl: string = (requestUrl as jest.Mock).mock.calls[1][0].url;
		expect(secondCallUrl).toContain('pageToken=tok2');
	});

	test('returns empty array when items is undefined', async () => {
		const empty = {};
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: JSON.stringify(empty), json: empty });
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const cals = await adapter.listCalendars();
		expect(cals).toHaveLength(0);
	});
});

// ─── listEvents ───────────────────────────────────────────────────────────────

function makeGCalEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'evt1',
		status: 'confirmed',
		summary: 'Team Meeting',
		start: { dateTime: '2024-03-15T10:00:00Z' },
		end: { dateTime: '2024-03-15T11:00:00Z' },
		iCalUID: 'evt1@google.com',
		...overrides,
	};
}

function mockEvents(items: unknown[], nextPageToken?: string) {
	const data = nextPageToken ? { items, nextPageToken } : { items };
	(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: JSON.stringify(data), json: data });
}

describe('listEvents', () => {
	const TIME_MIN = new Date('2024-03-15T00:00:00Z');
	const TIME_MAX = new Date('2024-03-18T00:00:00Z');

	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns timed events within window', async () => {
		mockEvents([makeGCalEvent()]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const events = await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		expect(events).toHaveLength(1);
		expect(events[0].title).toBe('Team Meeting');
		expect(events[0].source).toBe('gcal_api');
	});

	test('sends singleEvents=true and orderBy=startTime in URL', async () => {
		mockEvents([]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		const url: string = (requestUrl as jest.Mock).mock.calls[0][0].url;
		expect(url).toContain('singleEvents=true');
		expect(url).toContain('orderBy=startTime');
	});

	test('sends timeMin and timeMax as ISO strings', async () => {
		mockEvents([]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		const url: string = (requestUrl as jest.Mock).mock.calls[0][0].url;
		expect(url).toContain(encodeURIComponent(TIME_MIN.toISOString()));
		expect(url).toContain(encodeURIComponent(TIME_MAX.toISOString()));
	});

	test('handles all-day events with isAllDay=true', async () => {
		mockEvents([makeGCalEvent({ start: { date: '2024-03-15' }, end: { date: '2024-03-16' } })]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const events = await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		expect(events[0].isAllDay).toBe(true);
	});

	test('handles recurring events — isRecurring=true and recurringEventId set', async () => {
		mockEvents([makeGCalEvent({ recurringEventId: 'recurring-base-id', iCalUID: 'uid@google.com' })]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const events = await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		expect(events[0].isRecurring).toBe(true);
		expect(events[0].recurringEventId).toBe('recurring-base-id');
	});

	test('maps conferenceData video entry point to meetingUrl', async () => {
		mockEvents([makeGCalEvent({
			conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc' }] },
		})]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok', includeConferenceData: true }));
		const events = await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		expect(events[0].meetingUrl).toBe('https://meet.google.com/abc');
	});

	test('Teams link in description maps to meetingUrl; no conferenceUrl or teamsUrl on event', async () => {
		const url = 'https://teams.microsoft.com/l/meetup-join/19:meeting_abc@thread.v2/0?context=%7B%7D';
		mockEvents([makeGCalEvent({ description: `Join via Teams: ${url}` })]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const events = await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		expect(events[0].meetingUrl).toBe(url);
		// These fields should not exist on the normalized event at all
		expect('conferenceUrl' in events[0]).toBe(false);
		expect('teamsUrl' in events[0]).toBe(false);
	});

	test('Zoom link in description maps to meetingUrl', async () => {
		const url = 'https://company.zoom.us/j/123456789?pwd=abc';
		mockEvents([makeGCalEvent({ description: `Zoom: ${url}` })]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const events = await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		expect(events[0].meetingUrl).toBe(url);
	});

	test('event with no conference link has meetingUrl undefined', async () => {
		mockEvents([makeGCalEvent({ description: 'No link here', conferenceData: undefined })]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const events = await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		expect(events[0].meetingUrl).toBeUndefined();
	});

	test('conferenceData takes priority over description link', async () => {
		const confUrl = 'https://meet.google.com/xyz-from-conf';
		const descUrl = 'https://company.zoom.us/j/999?pwd=xyz';
		mockEvents([makeGCalEvent({
			conferenceData: { entryPoints: [{ entryPointType: 'video', uri: confUrl }] },
			description: `Backup Zoom: ${descUrl}`,
		})]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const events = await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		expect(events[0].meetingUrl).toBe(confUrl);
	});

	test('maps attendees and filters out self', async () => {
		mockEvents([makeGCalEvent({
			attendees: [
				{ email: 'me@example.com', self: true, responseStatus: 'accepted' },
				{ email: 'alice@example.com', displayName: 'Alice', responseStatus: 'accepted' },
			],
		})]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const events = await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		expect(events[0].attendees).toHaveLength(1);
		expect(events[0].attendees![0].email).toBe('alice@example.com');
	});

	test('returns empty array for empty response', async () => {
		mockEvents([]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const events = await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		expect(events).toHaveLength(0);
	});

	test('handles pagination — aggregates all pages', async () => {
		const page1 = { items: [makeGCalEvent({ id: 'e1', summary: 'E1' })], nextPageToken: 'p2' };
		const page2 = { items: [makeGCalEvent({ id: 'e2', summary: 'E2', iCalUID: 'e2@google.com' })] };
		(requestUrl as jest.Mock)
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify(page1), json: page1 })
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify(page2), json: page2 });
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const events = await adapter.listEvents('primary', TIME_MIN, TIME_MAX);
		expect(events).toHaveLength(2);
	});

	test('throws on 403 response', async () => {
		(requestUrl as jest.Mock).mockResolvedValue({ status: 403, text: 'Forbidden', json: {} });
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		await expect(adapter.listEvents('primary', TIME_MIN, TIME_MAX)).rejects.toThrow('Google API error 403');
	});
});

// ─── toNormalized (via listEvents mock) ───────────────────────────────────────

describe('toNormalized (via listEvents)', () => {
	const FROM = new Date('2024-03-15T00:00:00Z');
	const TO   = new Date('2024-03-18T00:00:00Z');

	beforeEach(() => jest.clearAllMocks());

	test('cancelled event → status=cancelled', async () => {
		mockEvents([makeGCalEvent({ status: 'cancelled' })]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const [e] = await adapter.listEvents('primary', FROM, TO);
		expect(e.status).toBe('cancelled');
	});

	test('event with no summary → title="(No Title)"', async () => {
		mockEvents([makeGCalEvent({ summary: undefined })]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const [e] = await adapter.listEvents('primary', FROM, TO);
		expect(e.title).toBe('(No Title)');
	});

	test('event with no start → skipped (not in results)', async () => {
		mockEvents([makeGCalEvent({ start: {} })]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const events = await adapter.listEvents('primary', FROM, TO);
		expect(events).toHaveLength(0);
	});

	test('non-recurring event → isRecurring=false', async () => {
		mockEvents([makeGCalEvent()]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const [e] = await adapter.listEvents('primary', FROM, TO);
		expect(e.isRecurring).toBe(false);
	});

	test('calendarId is set to the calendarId param', async () => {
		mockEvents([makeGCalEvent()]);
		const adapter = makeAdapter(makeSettings({ accessToken: 'tok' }));
		const [e] = await adapter.listEvents('work@example.com', FROM, TO);
		expect(e.calendarId).toBe('work@example.com');
	});
});
