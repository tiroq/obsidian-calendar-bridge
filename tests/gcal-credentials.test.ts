/**
 * Tests for parseGoogleCredentialsJson and maskClientId.
 */

import { parseGoogleCredentialsJson, maskClientId } from '../src/gcal-credentials';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_CLIENT_ID = '123456789-abcdef.apps.googleusercontent.com';
const VALID_SECRET = 'GOCSPX-supersecretvalue';

function makeInstalledJson(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		installed: {
			client_id: VALID_CLIENT_ID,
			client_secret: VALID_SECRET,
			redirect_uris: ['http://localhost'],
			...overrides,
		},
	});
}

function makeWebJson(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		web: {
			client_id: VALID_CLIENT_ID,
			client_secret: VALID_SECRET,
			redirect_uris: ['http://localhost'],
			...overrides,
		},
	});
}

// ─── parseGoogleCredentialsJson — happy paths ─────────────────────────────────

describe('parseGoogleCredentialsJson — happy paths', () => {
	test('parses installed client with client_secret', () => {
		const result = parseGoogleCredentialsJson(makeInstalledJson());
		expect(result).toEqual({
			type: 'installed',
			clientId: VALID_CLIENT_ID,
			clientSecret: VALID_SECRET,
		});
	});

	test('parses installed client without client_secret', () => {
		const raw = JSON.stringify({
			installed: {
				client_id: VALID_CLIENT_ID,
				redirect_uris: ['http://localhost'],
			},
		});
		const result = parseGoogleCredentialsJson(raw);
		expect(result).toEqual({
			type: 'installed',
			clientId: VALID_CLIENT_ID,
		});
		expect(result.clientSecret).toBeUndefined();
	});

	test('parses web client with client_secret', () => {
		const result = parseGoogleCredentialsJson(makeWebJson());
		expect(result).toEqual({
			type: 'web',
			clientId: VALID_CLIENT_ID,
			clientSecret: VALID_SECRET,
		});
	});

	test('parses web client without client_secret', () => {
		const raw = JSON.stringify({
			web: {
				client_id: VALID_CLIENT_ID,
				redirect_uris: ['http://localhost'],
			},
		});
		const result = parseGoogleCredentialsJson(raw);
		expect(result.type).toBe('web');
		expect(result.clientId).toBe(VALID_CLIENT_ID);
		expect(result.clientSecret).toBeUndefined();
	});

	test('prefers installed over web when both keys present', () => {
		const raw = JSON.stringify({
			installed: {
				client_id: VALID_CLIENT_ID,
				client_secret: VALID_SECRET,
			},
			web: {
				client_id: 'other-id.apps.googleusercontent.com',
				client_secret: 'other-secret',
			},
		});
		const result = parseGoogleCredentialsJson(raw);
		expect(result.type).toBe('installed');
		expect(result.clientId).toBe(VALID_CLIENT_ID);
	});

	test('ignores empty string client_secret (treats as absent)', () => {
		const result = parseGoogleCredentialsJson(makeInstalledJson({ client_secret: '' }));
		expect(result.clientSecret).toBeUndefined();
	});
});

// ─── parseGoogleCredentialsJson — error paths ─────────────────────────────────

describe('parseGoogleCredentialsJson — error paths', () => {
	test('throws on invalid JSON string', () => {
		expect(() => parseGoogleCredentialsJson('not json {')).toThrow(
			/Invalid JSON/i,
		);
	});

	test('throws on JSON array', () => {
		expect(() => parseGoogleCredentialsJson('[]')).toThrow(
			/expected a JSON object/i,
		);
	});

	test('throws on JSON null', () => {
		expect(() => parseGoogleCredentialsJson('null')).toThrow(
			/expected a JSON object/i,
		);
	});

	test('throws on JSON string primitive', () => {
		expect(() => parseGoogleCredentialsJson('"hello"')).toThrow(
			/expected a JSON object/i,
		);
	});

	test('throws when neither installed nor web key present', () => {
		expect(() =>
			parseGoogleCredentialsJson(JSON.stringify({ client_id: VALID_CLIENT_ID })),
		).toThrow(/Unrecognized credentials format/i);
	});

	test('throws when installed key is null', () => {
		expect(() =>
			parseGoogleCredentialsJson(JSON.stringify({ installed: null })),
		).toThrow(/Unrecognized credentials format/i);
	});

	test('throws when web key is null', () => {
		expect(() =>
			parseGoogleCredentialsJson(JSON.stringify({ web: null })),
		).toThrow(/Unrecognized credentials format/i);
	});

	test('throws when client_id is missing', () => {
		const raw = JSON.stringify({
			installed: { client_secret: VALID_SECRET },
		});
		expect(() => parseGoogleCredentialsJson(raw)).toThrow(
			/missing a valid "client_id"/i,
		);
	});

	test('throws when client_id is empty string', () => {
		const raw = JSON.stringify({
			installed: { client_id: '' },
		});
		expect(() => parseGoogleCredentialsJson(raw)).toThrow(
			/missing a valid "client_id"/i,
		);
	});

	test('throws when client_id is a number', () => {
		const raw = JSON.stringify({
			installed: { client_id: 12345 },
		});
		expect(() => parseGoogleCredentialsJson(raw)).toThrow(
			/missing a valid "client_id"/i,
		);
	});

	test('throws when client_id does not end with .apps.googleusercontent.com', () => {
		const raw = JSON.stringify({
			installed: { client_id: 'bad-client-id' },
		});
		expect(() => parseGoogleCredentialsJson(raw)).toThrow(
			/Unexpected client_id format/i,
		);
	});

	test('throws when client_id ends with wrong suffix', () => {
		const raw = JSON.stringify({
			installed: { client_id: 'abc123.apps.other.com' },
		});
		expect(() => parseGoogleCredentialsJson(raw)).toThrow(
			/Unexpected client_id format/i,
		);
	});
});

// ─── maskClientId ─────────────────────────────────────────────────────────────

describe('maskClientId', () => {
	test('masks middle section of a full client ID', () => {
		const masked = maskClientId(VALID_CLIENT_ID);
		expect(masked).toBe(VALID_CLIENT_ID.slice(0, 8) + '***' + VALID_CLIENT_ID.slice(-4));
		expect(masked).toContain('***');
		expect(masked).not.toBe(VALID_CLIENT_ID);
	});

	test('preserves first 8 chars', () => {
		const masked = maskClientId(VALID_CLIENT_ID);
		expect(masked.startsWith(VALID_CLIENT_ID.slice(0, 8))).toBe(true);
	});

	test('preserves last 4 chars', () => {
		const masked = maskClientId(VALID_CLIENT_ID);
		expect(masked.endsWith(VALID_CLIENT_ID.slice(-4))).toBe(true);
	});

	test('returns *** for short strings (≤12 chars)', () => {
		expect(maskClientId('short')).toBe('***');
		expect(maskClientId('exactly12ch!')).toBe('***');
	});

	test('handles 13-char string without throwing', () => {
		const result = maskClientId('abcdefghijklm');
		expect(result).toContain('***');
	});
});
