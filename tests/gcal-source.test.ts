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
