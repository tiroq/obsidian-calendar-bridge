/**
 * Google OAuth credentials JSON parser.
 *
 * Parses the JSON file downloaded from Google Cloud Console
 * (APIs & Services → Credentials → Download JSON) and extracts
 * the fields needed for the OAuth flow.
 *
 * Supported shapes:
 *   { "installed": { client_id, client_secret?, ... } }  ← Desktop app
 *   { "web":       { client_id, client_secret?, ... } }  ← Web application
 */

export interface ParsedGoogleCredentials {
	type: 'installed' | 'web';
	clientId: string;
	clientSecret?: string;
}

interface RawClientBlock {
	client_id?: unknown;
	client_secret?: unknown;
}

interface RawCredentialsJson {
	installed?: RawClientBlock;
	web?: RawClientBlock;
	[key: string]: unknown;
}

/**
 * Parse a raw credentials JSON string from Google Cloud Console.
 *
 * @throws {Error} with a human-readable message on any validation failure.
 */
export function parseGoogleCredentialsJson(raw: string): ParsedGoogleCredentials {
	let parsed: RawCredentialsJson;
	try {
		parsed = JSON.parse(raw) as RawCredentialsJson;
	} catch {
		throw new Error('Invalid JSON — could not parse the credentials file.');
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('Invalid credentials file — expected a JSON object.');
	}

	// Prefer 'installed' (Desktop app) over 'web'
	const type: 'installed' | 'web' | null =
		'installed' in parsed && parsed.installed != null
			? 'installed'
			: 'web' in parsed && parsed.web != null
				? 'web'
				: null;

	if (!type) {
		throw new Error(
			'Unrecognized credentials format — expected an "installed" or "web" key at the top level. ' +
			'Download the JSON from Google Cloud Console → APIs & Services → Credentials.',
		);
	}

	const block = parsed[type] as RawClientBlock;

	if (typeof block.client_id !== 'string' || !block.client_id) {
		throw new Error('Credentials JSON is missing a valid "client_id" field.');
	}

	const clientId = block.client_id;

	if (!clientId.endsWith('.apps.googleusercontent.com')) {
		throw new Error(
			`Unexpected client_id format: "${maskClientId(clientId)}". ` +
			'Expected a value ending in ".apps.googleusercontent.com".',
		);
	}

	const clientSecret =
		typeof block.client_secret === 'string' && block.client_secret
			? block.client_secret
			: undefined;

	return { type, clientId, clientSecret };
}

/** Mask all but the first 8 chars and last 4 chars of a client ID for safe logging. */
export function maskClientId(clientId: string): string {
	if (clientId.length <= 12) return '***';
	return clientId.slice(0, 8) + '***' + clientId.slice(-4);
}
