/**
 * Series-page management for Calendar Bridge.
 *
 * A "series" is a group of CalendarEvents that share the same UID
 * (i.e. all instances of a recurring meeting).  Each series gets a
 * dedicated index page that lists upcoming and past occurrences with
 * wikilinks, so users can navigate easily between the series and its
 * individual meeting notes.
 */

import { CalendarEvent, PluginSettings } from './types';
import { AUTOGEN_END, AUTOGEN_START, sanitizeFilename } from './note-generator';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SeriesInfo {
	/** RFC 5545 UID shared by all instances */
	uid: string;
	/** Human-readable title (from the first instance seen) */
	title: string;
	/** Source calendar display name */
	sourceName: string;
	/** All synced instances, sorted ascending by startDate */
	instances: CalendarEvent[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the vault path for a series index page.
 * Pattern: {seriesFolder}/{sanitized title}.md
 */
export function getSeriesPath(seriesTitle: string, settings: PluginSettings): string {
	return `${settings.seriesFolder}/${sanitizeFilename(seriesTitle)}.md`;
}

/**
 * Group a list of CalendarEvents by UID, returning a Map of series.
 * Non-recurring events are ignored.
 */
export function groupBySeries(events: CalendarEvent[]): Map<string, SeriesInfo> {
	const groups = new Map<string, SeriesInfo>();

	for (const event of events) {
		if (!event.isRecurring) continue;

		const existing = groups.get(event.uid);
		if (existing) {
			existing.instances.push(event);
			existing.instances.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
		} else {
			groups.set(event.uid, {
				uid: event.uid,
				title: event.title,
				sourceName: event.sourceName,
				instances: [event],
			});
		}
	}

	return groups;
}

// ─── Content generators ───────────────────────────────────────────────────────

/**
 * Build the AUTOGEN block body for a series page.
 * Splits instances into "upcoming" (start ≥ now) and "past" (start < now)
 * and renders each as a wikilink to its meeting note.
 *
 * @param series       Series metadata and its instances
 * @param notePathFn   Function that returns the vault path for a given event
 * @param now          Reference time (injectable for testing; defaults to new Date())
 */
export function generateSeriesAutogen(
	series: SeriesInfo,
	notePathFn: (event: CalendarEvent) => string,
	now: Date = new Date(),
): string {
	const toLink = (event: CalendarEvent): string => {
		const path = notePathFn(event);
		// Strip folder prefix and .md extension to get the bare note name
		const name = path.split('/').pop()?.replace(/\.md$/, '') ?? event.title;
		return `- [[${name}]]`;
	};

	const upcoming = series.instances.filter(e => e.startDate >= now);
	const past = series.instances.filter(e => e.startDate < now);

	const sections: string[] = [];

	if (upcoming.length > 0) {
		sections.push('## Upcoming Meetings\n' + upcoming.map(toLink).join('\n'));
	}

	if (past.length > 0) {
		// Show most-recent first for past meetings
		sections.push(
			'## Past Meetings\n' + [...past].reverse().map(toLink).join('\n'),
		);
	}

	return sections.join('\n\n');
}

/**
 * Wrap the AUTOGEN body in its start/end markers.
 */
export function wrapAutogen(body: string): string {
	return `${AUTOGEN_START}\n${body}\n${AUTOGEN_END}`;
}

/**
 * Generate the full content for a *new* series index page.
 */
export function generateSeriesPageContent(
	series: SeriesInfo,
	notePathFn: (event: CalendarEvent) => string,
	now: Date = new Date(),
): string {
	const autogenBody = generateSeriesAutogen(series, notePathFn, now);
	return `# ${series.title}

**Calendar:** ${series.sourceName}

${wrapAutogen(autogenBody)}

## Notes

*(Series-level notes here)*
`;
}
