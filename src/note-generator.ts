/**
 * Note generation utilities for Calendar Bridge.
 *
 * Responsibilities:
 *   - Default template definition
 *   - Placeholder substitution
 *   - AUTOGEN block replacement (update auto-generated regions while preserving
 *     any manual edits outside those regions)
 *   - File-name / folder-path helpers
 */

import { CalendarEvent, PluginSettings } from './types';

// ─── AUTOGEN block markers ────────────────────────────────────────────────────

export const AUTOGEN_START = '<!-- AUTOGEN:START -->';
export const AUTOGEN_END = '<!-- AUTOGEN:END -->';

// ─── Default template ─────────────────────────────────────────────────────────

/**
 * Built-in meeting-note template.
 * Content between the AUTOGEN markers is regenerated on every sync;
 * everything outside is preserved and can be freely edited by the user.
 */
export const DEFAULT_TEMPLATE = `# {{title}}

**Date:** {{date}}
**Time:** {{time}} – {{end_time}}
**Duration:** {{duration}}
**Location:** {{location}}

<!-- AUTOGEN:START -->
**Organizer:** {{organizer}}

**Attendees:**
{{attendees}}

**Description:**
{{description}}

**Calendar:** {{source}}
{{series_link}}<!-- AUTOGEN:END -->

## Notes

*(Add your notes here)*

## Action Items

- [ ] 
`;

// ─── Date / time formatting ───────────────────────────────────────────────────

/**
 * Format a Date using a simple token-based format string.
 * Supported tokens: YYYY  MM  DD  HH  mm  ss
 */
export function formatDate(date: Date, format: string): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return format
		.replace('YYYY', String(date.getFullYear()))
		.replace('MM', pad(date.getMonth() + 1))
		.replace('DD', pad(date.getDate()))
		.replace('HH', pad(date.getHours()))
		.replace('mm', pad(date.getMinutes()))
		.replace('ss', pad(date.getSeconds()));
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
 * Compute the vault path for a meeting note.
 * Pattern: {notesFolder}/{date} {sanitized title}.md
 */
export function getNotePath(event: CalendarEvent, settings: PluginSettings): string {
	const dateStr = formatDate(event.startDate, settings.dateFormat);
	const safeTitle = sanitizeFilename(event.title);
	return `${settings.notesFolder}/${dateStr} ${safeTitle}.md`;
}

// ─── Template filling ─────────────────────────────────────────────────────────

/**
 * Replace all `{{placeholder}}` tokens in the template with event data.
 *
 * @param template   Raw template string (may include AUTOGEN markers)
 * @param event      Calendar event to render
 * @param settings   Plugin settings (date/time formats)
 * @param seriesLink Wikilink to the series page, e.g. "[[Weekly Standup]]"
 */
export function fillTemplate(
	template: string,
	event: CalendarEvent,
	settings: PluginSettings,
	seriesLink?: string,
): string {
	const dateStr = formatDate(event.startDate, settings.dateFormat);
	const timeStr = event.isAllDay ? 'All day' : formatDate(event.startDate, settings.timeFormat);
	const endTimeStr = event.isAllDay ? '' : formatDate(event.endDate, settings.timeFormat);
	const duration = event.isAllDay ? 'All day' : formatDuration(event.startDate, event.endDate);

	const attendeesList = event.attendees
		.map(a => `- ${a.name ? `${a.name} <${a.email}>` : a.email}`)
		.join('\n');

	// Wrap series link in its own line only when present
	const seriesLinkLine = seriesLink ? `**Series:** ${seriesLink}\n` : '';

	return template
		.replace(/\{\{title\}\}/g, event.title)
		.replace(/\{\{date\}\}/g, dateStr)
		.replace(/\{\{time\}\}/g, timeStr)
		.replace(/\{\{end_time\}\}/g, endTimeStr)
		.replace(/\{\{duration\}\}/g, duration)
		.replace(/\{\{location\}\}/g, event.location)
		.replace(/\{\{description\}\}/g, event.description)
		.replace(/\{\{organizer\}\}/g, event.organizer ?? '')
		.replace(/\{\{attendees\}\}/g, attendeesList)
		.replace(/\{\{source\}\}/g, event.sourceName)
		.replace(/\{\{uid\}\}/g, event.uid)
		.replace(/\{\{series_link\}\}/g, seriesLinkLine);
}

// ─── AUTOGEN block replacement ────────────────────────────────────────────────

const AUTOGEN_RE = /<!-- AUTOGEN:START -->[\s\S]*?<!-- AUTOGEN:END -->/;

/**
 * Replace the AUTOGEN block in `existingContent` with the AUTOGEN block found
 * in `newContent`.  Content outside the markers is left untouched, preserving
 * any manual edits the user has made.
 *
 * If `existingContent` has no AUTOGEN block the new block is appended.
 * If `newContent` has no AUTOGEN block, `existingContent` is returned unchanged.
 */
export function updateAutogenBlocks(existingContent: string, newContent: string): string {
	const newBlockMatch = newContent.match(AUTOGEN_RE);
	if (!newBlockMatch) return existingContent;

	const newBlock = newBlockMatch[0];

	if (AUTOGEN_RE.test(existingContent)) {
		return existingContent.replace(AUTOGEN_RE, newBlock);
	}

	// No existing AUTOGEN block — append it
	return existingContent.trimEnd() + '\n\n' + newBlock + '\n';
}
