/**
 * Note generation for Calendar Bridge.
 *
 * Responsibilities:
 *   - Default template definition
 *   - Frontmatter generation (per doc 02 schema)
 *   - Placeholder substitution (all doc-04 variables)
 *   - Named AUTOGEN block replacement (AGENDA / JOINERS / LINKS)
 *   - File-name / folder-path helpers
 *
 * Named AUTOGEN regions (contract with doc 02):
 *   <!-- AUTOGEN:AGENDA:START --> … <!-- AUTOGEN:AGENDA:END -->
 *   <!-- AUTOGEN:JOINERS:START --> … <!-- AUTOGEN:JOINERS:END -->
 *   <!-- AUTOGEN:LINKS:START --> … <!-- AUTOGEN:LINKS:END -->
 *
 * Everything outside those regions is the user's zone and is NEVER touched.
 */

import { AttendeeInfo, CalendarEvent, NormalizedEvent, PluginSettings, SeriesProfile } from './types';
import { ContactMap } from './contacts';

// ─── Flexible settings alias ──────────────────────────────────────────────────
// Allows both the new PluginSettings and the legacy shape used in tests.

interface AnySettings {
	// new names
	meetingsRoot?: string;
	seriesRoot?: string;
	dateFolderFormat?: string;
	fileNameFormat?: string;
	timezoneDefault?: string;
	// legacy / shared
	dateFormat?: string;
	timeFormat?: string;
	notesFolder?: string;
	seriesFolder?: string;
}

// ─── AUTOGEN block markers ────────────────────────────────────────────────────

/** @deprecated Single-block legacy marker (kept for backward compat with tests). */
export const AUTOGEN_START = '<!-- AUTOGEN:START -->';
/** @deprecated Single-block legacy marker (kept for backward compat with tests). */
export const AUTOGEN_END   = '<!-- AUTOGEN:END -->';

export const AUTOGEN_AGENDA_START  = '<!-- AUTOGEN:AGENDA:START -->';
export const AUTOGEN_AGENDA_END    = '<!-- AUTOGEN:AGENDA:END -->';
export const AUTOGEN_JOINERS_START = '<!-- AUTOGEN:JOINERS:START -->';
export const AUTOGEN_JOINERS_END   = '<!-- AUTOGEN:JOINERS:END -->';
export const AUTOGEN_LINKS_START   = '<!-- AUTOGEN:LINKS:START -->';
export const AUTOGEN_LINKS_END     = '<!-- AUTOGEN:LINKS:END -->';

// ─── Default template ─────────────────────────────────────────────────────────

export const DEFAULT_TEMPLATE = `{{CB_FM}}

# {{title}}

**Date:** {{start_human}}
**Time:** {{start_human}} \u2013 {{end_human}}
**Duration:** {{duration}}
**Location:** {{location}}
**Conference:** {{conference_url}}
**Calendar:** {{calendar}}

<!-- AUTOGEN:AGENDA:START -->
{{agenda_block}}
<!-- AUTOGEN:AGENDA:END -->

<!-- AUTOGEN:JOINERS:START -->
{{joiners_block}}
<!-- AUTOGEN:JOINERS:END -->

<!-- AUTOGEN:LINKS:START -->
{{links_block}}
<!-- AUTOGEN:LINKS:END -->

## Notes

*(Add your notes here)*

## Action Items

- [ ] 
`;

// ─── Date / time formatting ───────────────────────────────────────────────────

/**
 * Format a Date using a simple token-based format string.
 * Supported tokens: YYYY MM DD HH mm ss
 */
export function formatDate(date: Date, format: string): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return format
		.replace('YYYY', String(date.getFullYear()))
		.replace('MM',   pad(date.getMonth() + 1))
		.replace('DD',   pad(date.getDate()))
		.replace('HH',   pad(date.getHours()))
		.replace('mm',   pad(date.getMinutes()))
		.replace('ss',   pad(date.getSeconds()));
}

/**
 * Return a human-readable duration string for the interval between two dates.
 * E.g. "30m", "1h", "1h 30m".
 */
export function formatDuration(start: Date, end: Date): string {
	const totalMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
	if (totalMinutes <= 0) return '0m';
	if (totalMinutes < 60) return `${totalMinutes}m`;
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── File-path helpers ────────────────────────────────────────────────────────

/**
 * Remove characters that are invalid in vault paths / file names and
 * collapse excess whitespace.  Truncated to 200 characters.
 */
export function sanitizeFilename(name: string): string {
	return name
		.replace(/[/\\:*?"<>|#^[\]]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 200);
}

/**
 * Compute a URL-friendly slug from a series name.
 * E.g. "TA Standup / weekly" → "ta-standup-weekly"
 */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 100);
}

/**
 * Compute the vault path for a meeting note.
 *
 * New pattern (when meetingsRoot is set):
 *   {meetingsRoot}/{YYYY-MM-DD}/{HHmm} [{SeriesName}] {Title}.md
 *
 * Legacy pattern (when only notesFolder is set — keeps tests passing):
 *   {notesFolder}/{dateStr} {Title}.md
 */
export function getNotePath(
	event: { title: string; startDate: Date },
	settings: AnySettings,
	seriesName?: string,
): string {
	const start      = event.startDate;
	const dateFormat = settings.dateFolderFormat ?? settings.dateFormat ?? 'YYYY-MM-DD';
	const datePart   = formatDate(start, dateFormat);
	const safeTitle  = sanitizeFilename(event.title);

	// Legacy path: tests use notesFolder without meetingsRoot
	if (settings.notesFolder && !settings.meetingsRoot) {
		return `${settings.notesFolder}/${datePart} ${safeTitle}.md`;
	}

	// New path with date-subfolder
	const root       = settings.meetingsRoot ?? 'Meetings';
	const timePart   = formatDate(start, 'HHmm');
	const seriesPart = seriesName ? `[${sanitizeFilename(seriesName)}] ` : '';
	const fileName   = sanitizeFilename(`${timePart} ${seriesPart}${event.title}`);
	return `${root}/${datePart}/${fileName}.md`;
}

/**
 * Compute vault paths for a batch of events, detecting filename conflicts.
 *
 * Normal case: `{HHmm} {Title}.md` — no ID in the name.
 * Conflict case: two or more events produce the same base path →
 *   each conflicting event gets `({shortId})` appended before the `.md`,
 *   e.g. `1300 Invoice (a1b2c3).md`.
 *
 * Short ID = last 8 alphanumeric characters of `event.eventId`.
 *
 * Map key: composite `${eventId}::${startISO}` — unique per instance even for
 * ICS recurring events that share the same UID/eventId.
 *
 * @returns Map<instanceKey, vaultPath> where instanceKey = `${eventId}::${startISO}`
 */
export function getNotePaths(
	events: Array<{ title: string; startDate: Date; eventId: string; start: string }>,
	settings: AnySettings,
	seriesName?: string,
): Map<string, string> {
	// Step 1: compute the base path and instance key for every event
	const basePaths = new Map<string, string>(); // instanceKey → basePath
	const instanceKeys: string[] = [];
	for (const event of events) {
		const instanceKey = `${event.eventId}::${event.start}`;
		instanceKeys.push(instanceKey);
		const basePath = getNotePath(event, settings, seriesName);
		basePaths.set(instanceKey, basePath);
	}

	// Step 2: find which base paths collide (appear more than once)
	const pathCounts = new Map<string, number>();
	for (const path of basePaths.values()) {
		pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
	}

	// Step 3: for collisions, rebuild the path with a short ID suffix
	const result = new Map<string, string>(); // instanceKey → finalPath
	for (let i = 0; i < events.length; i++) {
		const event = events[i];
		const instanceKey = instanceKeys[i];
		const base = basePaths.get(instanceKey)!;
		if ((pathCounts.get(base) ?? 1) > 1) {
			// Strip non-alphanumeric chars and take last 8 characters as the short ID
			const shortId = event.eventId.replace(/[^a-zA-Z0-9]/g, '').slice(-8);
			const withSuffix = base.replace(/\.md$/, ` (${shortId}).md`);
			result.set(instanceKey, withSuffix);
		} else {
			result.set(instanceKey, base);
		}
	}

	return result;
}

/**
 * Compute the vault path for a series index page.
 * Pattern: {seriesRoot}/{slug}.md
 */
export function getSeriesPagePath(seriesName: string, settings: AnySettings): string {
	const root = settings.seriesRoot ?? settings.seriesFolder ?? 'Meetings/_series';
	return `${root}/${slugify(seriesName)}.md`;
}

// ─── Frontmatter builder ──────────────────────────────────────────────────────

/**
 * Overrides for buildFrontmatter when updating existing notes.
 * Used to preserve user-set values that should not be overwritten by sync.
 */
export interface FrontmatterOverrides {
	/** If provided, use this draft value instead of defaulting to true. */
	draft?: boolean;
	/** If provided, use these attendees instead of syncing from calendar. */
	attendees?: string[];
}

/**
 * Build the YAML frontmatter string (without the --- fences) for a meeting note.
 *
 * @param overrides - Optional overrides for draft status and attendees.
 *   When `overrides.draft` is false, the note is considered confirmed and
 *   `overrides.attendees` (if provided) will be used instead of calendar data.
 */
export function buildFrontmatter(
	event: NormalizedEvent,
	settings: PluginSettings,
	seriesProfile?: SeriesProfile,
	contactMap?: ContactMap,
	overrides?: FrontmatterOverrides,
): string {
	const seriesName = seriesProfile?.seriesName ?? event.title;
	const tags       = buildTags(event, seriesProfile);
	const timezone   = event.timezone ?? settings.timezoneDefault ?? '';

	// Determine draft status:
	// 1. If overrides.draft is explicitly false, preserve it (user confirmed the note)
	// 2. If meeting is in the past, default to false (can't be a draft after it happened)
	// 3. Otherwise, true (upcoming meeting, still a draft)
	const isPast = event.startDate < new Date();
	const draft = overrides?.draft === false
		? false
		: (isPast ? false : true);

	const lines: string[] = [
		`type: meeting`,
		`title: ${yamlString(event.title)}`,
		`start: ${event.start}`,
		`end: ${event.end}`,
	];

	if (timezone) lines.push(`timezone: ${timezone}`);
	lines.push(`source: ${event.source}`);
	lines.push(`calendar_id: ${event.calendarId}`);
	lines.push(`event_id: ${event.eventId}`);
	lines.push(`ical_uid: ${event.uid}`);

	if (event.isRecurring) {
		lines.push(`series_key: ${event.seriesKey}`);
		lines.push(`series_name: ${yamlString(seriesName)}`);
	}

	lines.push(`status: ${event.status}`);
	lines.push(`draft: ${draft}`);

	if (!settings.redactionMode) {
		// Use preserved attendees if note is confirmed (draft: false) and we have them
		// Otherwise sync from calendar
		const usePreservedAttendees = overrides?.draft === false && overrides?.attendees;

		if (usePreservedAttendees) {
			// Preserve existing attendees exactly as they were
			lines.push(`attendees:`);
			for (const attendee of overrides.attendees!) {
				lines.push(`  - ${yamlString(attendee)}`);
			}
		} else if (event.attendees && event.attendees.length > 0) {
			lines.push(`attendees:`);
			for (const a of event.attendees) {
				const noteName = contactMap?.get(a.email.toLowerCase());
				if (noteName) {
					lines.push(`  - "[[${noteName}]]"`);
				} else {
					const label = a.name ? `${a.name} <${a.email}>` : a.email;
					lines.push(`  - ${yamlString(label)}`);
				}
			}
		}
		if (event.location)       lines.push(`location: ${yamlString(event.location)}`);
		if (event.meetingUrl)     lines.push(`meeting_url: ${event.meetingUrl}`);
	}

	if (tags.length > 0) {
		lines.push(`tags: [${tags.join(', ')}]`);
	}

	return lines.join('\n');
}

function buildTags(event: NormalizedEvent, profile?: SeriesProfile): string[] {
	const tags: string[] = ['meeting'];
	if (event.isRecurring) {
		const slug = slugify(profile?.seriesName ?? event.title);
		tags.push(`series/${slug}`);
	}
	if (profile?.tags) tags.push(...profile.tags);
	return [...new Set(tags)];
}

function yamlString(val: string): string {
	if (/[:#[\]{},&*?|<>=!%@`'"]/.test(val) || /^\d/.test(val)) {
		return `"${val.replace(/"/g, '\\"')}"`;
	}
	return val;
}

// ─── Frontmatter extraction helpers ──────────────────────────────────────────

/**
 * Extract draft status and attendees from existing note content.
 * Used to preserve user-confirmed values during sync.
 */
export function extractFrontmatterOverrides(content: string): FrontmatterOverrides | undefined {
	const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!fmMatch) return undefined;

	const yaml = fmMatch[1];
	const overrides: FrontmatterOverrides = {};

	// Extract draft value
	const draftMatch = yaml.match(/^draft:\s*(true|false)\s*$/m);
	if (draftMatch) {
		overrides.draft = draftMatch[1] === 'true';
	}

	// Extract attendees (both inline and block formats)
	const attendees: string[] = [];
	// Inline format: attendees: ["Name 1", "Name 2"] — .* allows ] inside [[WikiLinks]]
	const inlineMatch = yaml.match(/^attendees:\s*\[(.*)\]\s*$/m);
	if (inlineMatch) {
		const items = inlineMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
		attendees.push(...items.filter(s => s.length > 0));
	} else {
		// Block format: attendees:\n  - "Name 1"\n  - "Name 2"
		const blockMatch = yaml.match(/^attendees:\s*\n((?:\s+-\s+.+\n?)+)/m);
		if (blockMatch) {
			const lines = blockMatch[1].split('\n');
			for (const line of lines) {
				const itemMatch = line.match(/^\s+-\s+(.+)$/);
				if (itemMatch) {
					attendees.push(itemMatch[1].trim().replace(/^["']|["']$/g, ''));
				}
			}
		}
	}
	if (attendees.length > 0) {
		overrides.attendees = attendees;
	}

	return (overrides.draft !== undefined || overrides.attendees) ? overrides : undefined;
}

// ─── AUTOGEN block content builders ──────────────────────────────────────────

/** Build the AGENDA block body from event description and/or series profile. */
export function buildAgendaBlock(
	event: NormalizedEvent,
	profile?: SeriesProfile,
): string {
	if (profile?.defaultAgenda) {
		return profile.defaultAgenda.trim();
	}
	if (event.description) {
		return `## Agenda\n\n${event.description.trim()}`;
	}
	return '## Agenda\n\n*(No agenda set)*';
}

/** Build the JOINERS block body from event attendees. */
export function buildJoinersBlock(
	event: NormalizedEvent,
	settings: PluginSettings,
	profile?: SeriesProfile,
	contactMap?: ContactMap,
	extraAttendees?: AttendeeInfo[],
): string {
	if (settings.redactionMode) {
		return '## Attendees\n\n*(redacted)*';
	}

	const attendees = applyAttendeeFilters(event.attendees ?? [], profile);

	// Union-merge: include any extra attendees not already in the list
	if (extraAttendees && extraAttendees.length > 0) {
		const existing = new Set(attendees.map(a => a.email.toLowerCase()));
		for (const ea of extraAttendees) {
			if (!existing.has(ea.email.toLowerCase())) {
				attendees.push(ea);
			}
		}
	}

	if (attendees.length === 0) {
		return '## Attendees\n\n*(Unknown — no attendee data available)*';
	}

	const required = attendees.filter(a => !a.optional);
	const optional = attendees.filter(a => a.optional);
	const lines: string[] = ['## Attendees'];

	if (required.length > 0) {
		lines.push('');
		lines.push('**Required:**');
		for (const a of required) lines.push(formatAttendee(a, contactMap));
	}

	if (optional.length > 0) {
		lines.push('');
		lines.push('**Optional:**');
		for (const a of optional) lines.push(formatAttendee(a, contactMap));
	}

	return lines.join('\n');
}

function applyAttendeeFilters(
	attendees: AttendeeInfo[],
	profile?: SeriesProfile,
): AttendeeInfo[] {
	let result = [...attendees];
	if (profile?.hiddenAttendees?.length) {
		result = result.filter(a => !profile.hiddenAttendees!.includes(a.email));
	}
	if (profile?.pinnedAttendees?.length) {
		for (const email of profile.pinnedAttendees) {
			if (!result.find(a => a.email === email)) {
				result.push({ email });
			}
		}
	}
	return result;
}

function formatAttendee(a: AttendeeInfo, contactMap?: ContactMap): string {
	const noteName = contactMap?.get(a.email.toLowerCase());
	if (noteName) {
		return `- [[${noteName}]]`;
	}
	const name   = a.name ? `@${a.name} <${a.email}>` : `@${a.email}`;
	const status = a.responseStatus && a.responseStatus !== 'needsAction'
		? ` (${a.responseStatus})`
		: '';
	return `- ${name}${status}`;
}

/**
 * Extract attendee email addresses and wikilink note names already present
 * in an existing JOINERS block text.
 * Used for union-merge: attendees already written to the note are preserved.
 *
 * Recognises two patterns:
 *   - [[NoteName]]  (contact-linked)
 *   - @Name <email> or @email  (plain)
 */
export function extractExistingAttendees(joinersBlockText: string): AttendeeInfo[] {
	const result: AttendeeInfo[] = [];
	const seenEmails = new Set<string>();

	// Pattern 1: [[NoteName]] — we can only carry the name, no email known.
	// We preserve them as a special sentinel with email = '[[NoteName]]'
	// so the union-merge doesn't lose them.
	const wikilinkRe = /\[\[([^\]]+)\]\]/g;
	let wm: RegExpExecArray | null;
	while ((wm = wikilinkRe.exec(joinersBlockText)) !== null) {
		const sentinel = `[[${wm[1]}]]`;
		if (!seenEmails.has(sentinel)) {
			seenEmails.add(sentinel);
			result.push({ email: sentinel, name: wm[1] });
		}
	}

	// Pattern 2: @Name <email> or @email
	const emailRe = /^\s*-\s+@[^<]*<([^>]+)>/gm;
	let em: RegExpExecArray | null;
	while ((em = emailRe.exec(joinersBlockText)) !== null) {
		const email = em[1].trim().toLowerCase();
		if (!seenEmails.has(email)) {
			seenEmails.add(email);
			result.push({ email: em[1].trim() });
		}
	}

	// Pattern 3: bare @email (no angle brackets)
	const bareEmailRe = /^\s*-\s+@([^\s<(\[]+)/gm;
	let be: RegExpExecArray | null;
	while ((be = bareEmailRe.exec(joinersBlockText)) !== null) {
		const email = be[1].trim().toLowerCase();
		// skip if already captured via wikilink sentinel or angle-bracket pattern
		if (!seenEmails.has(email) && !seenEmails.has(`[[${be[1].trim()}]]`)) {
			seenEmails.add(email);
			result.push({ email: be[1].trim() });
		}
	}

	return result;
}

/** Build the LINKS block (series page link + prev/next navigation). */
export function buildLinksBlock(opts: {
	event: NormalizedEvent;
	seriesPagePath?: string;
	prevPath?: string;
	nextPath?: string;
	cancelled?: boolean;
}): string {
	const { event, seriesPagePath, prevPath, nextPath, cancelled } = opts;
	const lines: string[] = ['## Links'];

	if (cancelled) {
		lines.push('');
		lines.push('> ⚠️ This event was **cancelled**.');
	}

	if (seriesPagePath) {
		const name = seriesPagePath.split('/').pop()?.replace(/\.md$/, '') ?? event.title;
		lines.push('');
		lines.push(`Series: [[${name}]]`);
	}

	if (prevPath) {
		const name = prevPath.split('/').pop()?.replace(/\.md$/, '') ?? 'Previous';
		lines.push(`Prev: [[${name}]]`);
	}

	if (nextPath) {
		const name = nextPath.split('/').pop()?.replace(/\.md$/, '') ?? 'Next';
		lines.push(`Next: [[${name}]]`);
	}
	if (event.meetingUrl) {
		lines.push('');
		lines.push(`🔗 Join Meeting: [Open](${event.meetingUrl})`);
	}

	return lines.join('\n');
}

// ─── New template fill (NormalizedEvent) ─────────────────────────────────────

export interface FillTemplateOptions {
	event: NormalizedEvent;
	settings: PluginSettings;
	profile?: SeriesProfile;
	seriesPagePath?: string;
	prevPath?: string;
	nextPath?: string;
	contactMap?: ContactMap;
}

/**
 * Replace all `{{placeholder}}` tokens in the template with event data.
 * Supports all doc-04 placeholders.
 */
export function fillTemplateNormalized(
	template: string,
	opts: FillTemplateOptions,
): string {
	const { event, settings, profile, seriesPagePath, prevPath, nextPath, contactMap } = opts;

	const tz         = event.timezone ?? settings.timezoneDefault ?? '';
	const timeFormat = settings.timeFormat ?? 'HH:mm';
	const dateFormat = settings.dateFormat ?? 'YYYY-MM-DD';

	const dateStr    = formatDate(event.startDate, dateFormat);
	const timeStr    = event.isAllDay ? 'All day' : formatDate(event.startDate, timeFormat);
	const endTimeStr = event.isAllDay ? '' : formatDate(event.endDate, timeFormat);

	const startHuman = event.isAllDay
		? 'All day'
		: `${formatDate(event.startDate, dateFormat)} ${formatDate(event.startDate, timeFormat)}${tz ? ` (${tz})` : ''}`;
	const endHuman = event.isAllDay
		? ''
		: `${formatDate(event.endDate, dateFormat)} ${formatDate(event.endDate, timeFormat)}${tz ? ` (${tz})` : ''}`;
	const duration = event.isAllDay
		? 'All day'
		: formatDuration(event.startDate, event.endDate);

	const seriesName   = profile?.seriesName ?? event.title;
	const agendaBlock  = buildAgendaBlock(event, profile);
	const joinersBlock = buildJoinersBlock(event, settings, profile, contactMap);
	const linksBlock   = buildLinksBlock({
		event,
		seriesPagePath,
		prevPath,
		nextPath,
		cancelled: event.status === 'cancelled',
	});
	const frontmatter = buildFrontmatter(event, settings, profile, contactMap);

	const attendeesYaml = (event.attendees ?? [])
		.map(a => `  - ${a.name ? `${a.name} <${a.email}>` : a.email}`)
		.join('\n');

	return template
		.replace(/\{\{frontmatter\}\}/g,      frontmatter)
		.replace(/\{\{title\}\}/g,            event.title)
		.replace(/\{\{date\}\}/g,             dateStr)
		.replace(/\{\{time\}\}/g,             timeStr)
		.replace(/\{\{end_time\}\}/g,         endTimeStr)
		.replace(/\{\{start_iso\}\}/g,        event.start)
		.replace(/\{\{end_iso\}\}/g,          event.end)
		.replace(/\{\{start_human\}\}/g,      startHuman)
		.replace(/\{\{end_human\}\}/g,        endHuman)
		.replace(/\{\{duration\}\}/g,         duration)
		.replace(/\{\{timezone\}\}/g,         tz)
		.replace(/\{\{calendar\}\}/g,         event.sourceName)
		.replace(/\{\{series_name\}\}/g,      seriesName)
		.replace(/\{\{series_key\}\}/g,       event.seriesKey)
		.replace(/\{\{location\}\}/g,         event.location ?? '')
		.replace(/\{\{meeting_url\}\}/g,    event.meetingUrl ?? '')
		.replace(/\{\{attendees_yaml\}\}/g,   attendeesYaml)
		.replace(/\{\{agenda_block\}\}/g,     agendaBlock)
		.replace(/\{\{joiners_block\}\}/g,    joinersBlock)
		.replace(/\{\{links_block\}\}/g,      linksBlock);
}

// ─── Named AUTOGEN block replacement ─────────────────────────────────────────

function namedAutogenRe(name: string): RegExp {
	return new RegExp(
		`<!--\\s*AUTOGEN:${name}:START\\s*-->[\\s\\S]*?<!--\\s*AUTOGEN:${name}:END\\s*-->`,
		'g',
	);
}

function replaceNamedBlock(
	content: string,
	name: string,
	newBody: string,
): { content: string; replaced: boolean } {
	const re         = namedAutogenRe(name);
	const startMarker = `<!-- AUTOGEN:${name}:START -->`;
	const endMarker   = `<!-- AUTOGEN:${name}:END -->`;
	const newBlock    = `${startMarker}\n${newBody}\n${endMarker}`;

	if (re.test(content)) {
		return { content: content.replace(namedAutogenRe(name), newBlock), replaced: true };
	}
	return { content, replaced: false };
}

/**
 * Update all three named AUTOGEN blocks in an existing note.
 * Content outside the blocks is preserved (user's zone).
 * Missing blocks are appended.
 */
export function updateAutogenBlocksNamed(
	existingContent: string,
	opts: { agendaBody: string; joinersBody: string; linksBody: string },
): string {
	let content = existingContent;
	for (const [name, body] of [
		['AGENDA',  opts.agendaBody],
		['JOINERS', opts.joinersBody],
		['LINKS',   opts.linksBody],
	] as [string, string][]) {
		const { content: updated, replaced } = replaceNamedBlock(content, name, body);
		if (replaced) {
			content = updated;
		} else {
			const startMarker = `<!-- AUTOGEN:${name}:START -->`;
			const endMarker   = `<!-- AUTOGEN:${name}:END -->`;
			content = content.trimEnd() + `\n\n${startMarker}\n${body}\n${endMarker}\n`;
		}
	}
	return content;
}

// ─── Legacy single-block helpers (kept for test compatibility) ────────────────

const AUTOGEN_RE = /<!-- AUTOGEN:START -->[\s\S]*?<!-- AUTOGEN:END -->/;

/**
 * Replace the single AUTOGEN block in existingContent with the one from newContent.
 * Content outside the markers is untouched.
 * Kept for test backward compatibility.
 */
export function updateAutogenBlocks(existingContent: string, newContent: string): string {
	const newBlockMatch = newContent.match(AUTOGEN_RE);
	if (!newBlockMatch) return existingContent;
	const newBlock = newBlockMatch[0];
	if (AUTOGEN_RE.test(existingContent)) {
		return existingContent.replace(AUTOGEN_RE, newBlock);
	}
	return existingContent.trimEnd() + '\n\n' + newBlock + '\n';
}

// ─── Legacy CalendarEvent fillTemplate (kept for test compatibility) ──────────

/**
 * @deprecated Use fillTemplateNormalized with NormalizedEvent.
 * Kept to satisfy existing tests that import fillTemplate + CalendarEvent.
 */
export function fillTemplate(
	template: string,
	event: CalendarEvent,
	settings: AnySettings,
	seriesLink?: string,
): string {
	const dateFormat = settings.dateFormat ?? 'YYYY-MM-DD';
	const timeFormat = settings.timeFormat ?? 'HH:mm';

	const dateStr    = formatDate(event.startDate, dateFormat);
	const timeStr    = event.isAllDay ? 'All day' : formatDate(event.startDate, timeFormat);
	const endTimeStr = event.isAllDay ? '' : formatDate(event.endDate, timeFormat);
	const duration   = event.isAllDay ? 'All day' : formatDuration(event.startDate, event.endDate);

	const attendeesList = event.attendees
		.map(a => `- ${a.name ? `${a.name} <${a.email}>` : a.email}`)
		.join('\n');

	const seriesLinkLine = seriesLink ? `**Series:** ${seriesLink}\n` : '';

	return template
		.replace(/\{\{title\}\}/g,       event.title)
		.replace(/\{\{date\}\}/g,        dateStr)
		.replace(/\{\{time\}\}/g,        timeStr)
		.replace(/\{\{end_time\}\}/g,    endTimeStr)
		.replace(/\{\{duration\}\}/g,    duration)
		.replace(/\{\{location\}\}/g,    event.location)
		.replace(/\{\{description\}\}/g, event.description)
		.replace(/\{\{organizer\}\}/g,   event.organizer ?? '')
		.replace(/\{\{attendees\}\}/g,   attendeesList)
		.replace(/\{\{source\}\}/g,      event.sourceName)
		.replace(/\{\{uid\}\}/g,         event.uid)
		.replace(/\{\{series_link\}\}/g, seriesLinkLine);
}
