/**
 * Series-page management for Calendar Bridge.
 *
 * A "series" is a group of NormalizedEvents sharing the same seriesKey.
 * Each series gets a dedicated index page listing occurrences grouped by month,
 * with wikilinks to individual meeting notes.
 *
 * This module also provides prev/next link computation for the AUTOGEN:LINKS
 * block in each meeting note.
 */

import { CalendarEvent, NormalizedEvent, PluginSettings, SeriesProfile } from './types';
import { AUTOGEN_END, AUTOGEN_START, sanitizeFilename, slugify } from './note-generator';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SeriesInfo {
	/** Stable series identifier (seriesKey for NormalizedEvent, uid for legacy) */
	uid: string;
	/** Human-readable title (from the first instance seen) */
	title: string;
	/** Source calendar display name */
	sourceName: string;
	/** All synced instances, sorted ascending by startDate */
	instances: CalendarEvent[];
}

/** Extended series info using NormalizedEvent */
export interface SeriesInfoNormalized {
	seriesKey: string;
	seriesName: string;
	sourceName: string;
	instances: NormalizedEvent[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Flexible settings for path helpers — accepts both new and legacy shapes. */
type PathSettings = Partial<PluginSettings> & {
	seriesFolder?: string;
	seriesRoot?: string;
};

/**
 * Compute the vault path for a series index page.
 * Pattern: {seriesRoot}/{slug}.md
 */
export function getSeriesPath(seriesTitle: string, settings: PathSettings): string {
	const root = settings.seriesFolder ?? settings.seriesRoot ?? 'Meetings/_series';
	return `${root}/${sanitizeFilename(seriesTitle)}.md`;
}

/**
 * Compute the vault path for a series index page using a slug.
 * Pattern: {seriesRoot}/{slug(seriesName)}.md
 */
export function getSeriesPagePathByKey(seriesName: string, settings: PathSettings): string {
	const root = settings.seriesFolder ?? settings.seriesRoot ?? 'Meetings/_series';
	return `${root}/${slugify(seriesName)}.md`;
}

// ─── Legacy groupBySeries (CalendarEvent) ─────────────────────────────────────

/**
 * Group a list of CalendarEvents by UID, returning a Map of series.
 * Non-recurring events are ignored.
 * Kept for sync-manager backward compatibility.
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
				uid:        event.uid,
				title:      event.title,
				sourceName: event.sourceName,
				instances:  [event],
			});
		}
	}

	return groups;
}

// ─── NormalizedEvent grouping ─────────────────────────────────────────────────

/**
 * Group NormalizedEvents by seriesKey.
 * Non-recurring events are ignored.
 */
export function groupBySeriesNormalized(
	events: NormalizedEvent[],
): Map<string, SeriesInfoNormalized> {
	const groups = new Map<string, SeriesInfoNormalized>();

	for (const event of events) {
		if (!event.isRecurring) continue;

		const existing = groups.get(event.seriesKey);
		if (existing) {
			existing.instances.push(event);
			existing.instances.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
		} else {
			groups.set(event.seriesKey, {
				seriesKey:  event.seriesKey,
				seriesName: event.title,
				sourceName: event.sourceName,
				instances:  [event],
			});
		}
	}

	return groups;
}

// ─── Prev/Next link computation ───────────────────────────────────────────────

export interface PrevNextLinks {
	prevPath: string | undefined;
	nextPath: string | undefined;
}

/**
 * For a given event within a series, compute the vault paths of its
 * immediately preceding and following instances.
 *
 * @param event       The event we are rendering
 * @param series      All instances in the series (sorted ascending)
 * @param notePathFn  Resolves a NormalizedEvent to its vault path
 */
export function computePrevNext(
	event: NormalizedEvent,
	series: SeriesInfoNormalized,
	notePathFn: (e: NormalizedEvent) => string,
): PrevNextLinks {
	const sorted = [...series.instances].sort(
		(a, b) => a.startDate.getTime() - b.startDate.getTime(),
	);
	const idx = sorted.findIndex(e => e.eventId === event.eventId);
	if (idx === -1) return { prevPath: undefined, nextPath: undefined };

	const prevPath = idx > 0                   ? notePathFn(sorted[idx - 1]) : undefined;
	const nextPath = idx < sorted.length - 1   ? notePathFn(sorted[idx + 1]) : undefined;

	return { prevPath, nextPath };
}

// ─── Series page content generators ──────────────────────────────────────────

/**
 * Build the AUTOGEN block body for a series page.
 * Groups instances by month, renders each as a wikilink.
 * Cancelled events are flagged with ~~strikethrough~~.
 *
 * @param series       Series metadata and its instances
 * @param notePathFn   Function that returns the vault path for a given event
 * @param now          Reference time (injectable for testing)
 */
export function generateSeriesAutogen(
	series: SeriesInfo,
	notePathFn: (event: CalendarEvent) => string,
	now: Date = new Date(),
): string {
	const toLink = (event: CalendarEvent): string => {
		const path = notePathFn(event);
		const name = path.split('/').pop()?.replace(/\.md$/, '') ?? event.title;
		return `- [[${name}]]`;
	};

	const upcoming = series.instances.filter(e => e.startDate >= now);
	const past     = series.instances.filter(e => e.startDate < now);

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
 * Build the AUTOGEN block body for a series page using NormalizedEvents.
 * Groups instances by month (YYYY-MM).
 */
export function generateSeriesAutogenNormalized(
	series: SeriesInfoNormalized,
	notePathFn: (event: NormalizedEvent) => string,
	now: Date = new Date(),
): string {
	const toLink = (event: NormalizedEvent): string => {
		const path = notePathFn(event);
		const name = path.split('/').pop()?.replace(/\.md$/, '') ?? event.title;
		const cancelled = event.status === 'cancelled' ? `~~${name}~~` : name;
		return `- [[${cancelled}]]`;
	};

	const sorted = [...series.instances].sort(
		(a, b) => a.startDate.getTime() - b.startDate.getTime(),
	);

	const upcoming = sorted.filter(e => e.startDate >= now);
	const past     = sorted.filter(e => e.startDate < now);

	const sections: string[] = [];

	if (upcoming.length > 0) {
		const monthGroups = groupByMonth(upcoming);
		const block       = renderMonthGroups(monthGroups, toLink);
		sections.push(`## Upcoming\n\n${block}`);
	}

	if (past.length > 0) {
		// Most recent first for past
		const monthGroups = groupByMonth([...past].reverse());
		const block       = renderMonthGroups(monthGroups, toLink);
		sections.push(`## Past\n\n${block}`);
	}

	return sections.join('\n\n');
}

function groupByMonth(events: NormalizedEvent[]): Map<string, NormalizedEvent[]> {
	const groups = new Map<string, NormalizedEvent[]>();
	for (const e of events) {
		const key = `${e.startDate.getFullYear()}-${String(e.startDate.getMonth() + 1).padStart(2, '0')}`;
		const existing = groups.get(key);
		if (existing) {
			existing.push(e);
		} else {
			groups.set(key, [e]);
		}
	}
	return groups;
}

function renderMonthGroups(
	groups: Map<string, NormalizedEvent[]>,
	toLink: (e: NormalizedEvent) => string,
): string {
	const lines: string[] = [];
	for (const [month, events] of groups) {
		// Format "YYYY-MM" → "January 2026"
		const [y, m] = month.split('-');
		const label = new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', {
			month: 'long',
			year:  'numeric',
		});
		lines.push(`### ${label}`);
		lines.push('');
		for (const e of events) {
			lines.push(toLink(e));
		}
		lines.push('');
	}
	return lines.join('\n').trimEnd();
}

/**
 * Wrap the AUTOGEN body in its start/end markers.
 */
export function wrapAutogen(body: string): string {
	return `${AUTOGEN_START}\n${body}\n${AUTOGEN_END}`;
}

/**
 * Generate the full content for a *new* series index page (legacy CalendarEvent).
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

/**
 * Generate the full content for a *new* series index page (NormalizedEvent).
 * Includes YAML frontmatter per doc 02.
 */
export function generateSeriesPageNormalized(
	series: SeriesInfoNormalized,
	notePathFn: (event: NormalizedEvent) => string,
	profile?: SeriesProfile,
	now: Date = new Date(),
): string {
	const slug        = slugify(series.seriesName);
	const autogenBody = generateSeriesAutogenNormalized(series, notePathFn, now);

	const frontmatter = [
		`type: meeting_series`,
		`series_key: ${series.seriesKey}`,
		`series_name: "${series.seriesName.replace(/"/g, '\\"')}"`,
		`calendar: ${series.sourceName}`,
		profile?.tags?.length ? `tags: [${profile.tags.join(', ')}]` : '',
	].filter(Boolean).join('\n');

	return `---
${frontmatter}
---
# ${series.seriesName}

**Calendar:** ${series.sourceName}
**Series slug:** ${slug}

${wrapAutogen(autogenBody)}

## Notes

*(Series-level notes here)*
`;
}
