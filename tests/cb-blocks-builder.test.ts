/**
 * Unit tests for CbBlocksBuilder.
 *
 * Tests that buildCbBlocks():
 *   1. Returns all 10 CB slots with string values (never undefined)
 *   2. CB_CONTEXT / CB_ACTIONS for recurring events redirect to the series note
 *   3. Returns empty strings for CB_CONTEXT / CB_ACTIONS for non-recurring events
 *   4. CB_FM contains expected frontmatter fields
 *   5. CB_HEADER contains the event title
 *   6. CB_LINKS contains series link when seriesPagePath is provided
 *   7. CB_DIAGNOSTICS is empty when debugEnabled=false
 *   8. CB_DIAGNOSTICS is populated when debugEnabled=true
 */

import { App } from './__mocks__/obsidian';
import { buildCbBlocks } from '../src/services/CbBlocksBuilder';
import { ContextService } from '../src/services/ContextService';
import { ActionAggregationService } from '../src/services/ActionAggregationService';
import { CB_SLOTS, CbSlot } from '../src/services/TemplateService';
import { NormalizedEvent, PluginSettings, DEFAULT_SETTINGS } from '../src/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
	return {
		source: 'ics_public',
		calendarId: 'cal-1',
		eventId: 'evt-001',
		uid: 'uid-001@test',
		title: 'Team Meeting',
		start: '2024-03-01T10:00:00Z',
		end: '2024-03-01T11:00:00Z',
		startDate: new Date('2024-03-01T10:00:00Z'),
		endDate: new Date('2024-03-01T11:00:00Z'),
		isAllDay: false,
		status: 'confirmed',
		seriesKey: '',
		isRecurring: false,
		sourceName: 'Work Calendar',
		...overrides,
	};
}

function makeRecurringEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
	return makeEvent({
		isRecurring: true,
		seriesKey: 'series-key-standup',
		title: 'Daily Standup',
		...overrides,
	});
}

function makeSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeParams(
	event: NormalizedEvent,
	settings: PluginSettings,
	app: App,
	overrides: {
		seriesPagePath?: string;
		debugEnabled?: boolean;
		contextService?: ContextService;
		actionService?: ActionAggregationService;
	} = {},
) {
	return {
		app: app as never,
		event,
		settings,
		notesFolder: 'Meetings',
		seriesFolder: 'Meetings/_series',
		seriesPagePath: overrides.seriesPagePath,
		contactMap: new Map(),
		contextService: overrides.contextService ?? new ContextService(app as never),
		actionService: overrides.actionService ?? new ActionAggregationService(app as never),
		debugEnabled: overrides.debugEnabled ?? false,
	};
}

// ─── Core contract: all 10 slots always present ────────────────────────────────────

describe('buildCbBlocks — slot completeness', () => {
	it('returns all 10 CB slots as strings (never undefined)', async () => {
		const app = new App();
		const event = makeEvent();
		const settings = makeSettings();
		const blocks = await buildCbBlocks(makeParams(event, settings, app));

		for (const slot of CB_SLOTS) {
			expect(typeof blocks[slot]).toBe('string');
		}
	});

	it('returns exactly the 10 expected slots', async () => {
		const app = new App();
		const event = makeEvent();
		const settings = makeSettings();
		const blocks = await buildCbBlocks(makeParams(event, settings, app));

		const expectedSlots: CbSlot[] = [
			'CB_FM', 'CB_HEADER', 'CB_LINKS',
			'CB_CONTEXT', 'CB_ACTIONS',
			'CB_BODY', 'CB_DECISIONS', 'CB_DIAGNOSTICS', 'CB_FOOTER',
			'CB_SERIES_LINK',
		];
		for (const slot of expectedSlots) {
			expect(blocks).toHaveProperty(slot);
		}
		expect(Object.keys(blocks)).toHaveLength(10);
	});
});

// ─── CB_FM ────────────────────────────────────────────────────────────────────

describe('buildCbBlocks — CB_FM', () => {
	it('contains the event title', async () => {
		const app = new App();
		const event = makeEvent({ title: 'Q1 Planning' });
		const settings = makeSettings();
		const { CB_FM } = await buildCbBlocks(makeParams(event, settings, app));
		expect(CB_FM).toContain('Q1 Planning');
	});

	it('contains type: meeting', async () => {
		const app = new App();
		const { CB_FM } = await buildCbBlocks(makeParams(makeEvent(), makeSettings(), app));
		expect(CB_FM).toContain('type: meeting');
	});

	it('contains series_key for recurring events', async () => {
		const app = new App();
		const event = makeRecurringEvent();
		const { CB_FM } = await buildCbBlocks(makeParams(event, makeSettings(), app));
		expect(CB_FM).toContain('series_key: series-key-standup');
	});

	it('omits series_key for non-recurring events', async () => {
		const app = new App();
		const { CB_FM } = await buildCbBlocks(makeParams(makeEvent(), makeSettings(), app));
		expect(CB_FM).not.toContain('series_key');
	});
});

// ─── CB_HEADER ────────────────────────────────────────────────────────────────

describe('buildCbBlocks — CB_HEADER', () => {
	it('contains the event title as heading', async () => {
		const app = new App();
		const event = makeEvent({ title: 'Sprint Review' });
		const { CB_HEADER } = await buildCbBlocks(makeParams(event, makeSettings(), app));
		expect(CB_HEADER).toContain('## Sprint Review');
	});

	it('contains the calendar source name', async () => {
		const app = new App();
		const event = makeEvent({ sourceName: 'My Calendar' });
		const { CB_HEADER } = await buildCbBlocks(makeParams(event, makeSettings(), app));
		expect(CB_HEADER).toContain('My Calendar');
	});

	it('marks recurring events', async () => {
		const app = new App();
		const event = makeRecurringEvent();
		const { CB_HEADER } = await buildCbBlocks(makeParams(event, makeSettings(), app));
		expect(CB_HEADER).toContain('Recurring');
	});

	it('does not mark non-recurring events as recurring', async () => {
		const app = new App();
		const event = makeEvent();
		const { CB_HEADER } = await buildCbBlocks(makeParams(event, makeSettings(), app));
		expect(CB_HEADER).not.toContain('Recurring');
	});

	it('marks cancelled events', async () => {
		const app = new App();
		const event = makeEvent({ status: 'cancelled' });
		const { CB_HEADER } = await buildCbBlocks(makeParams(event, makeSettings(), app));
		expect(CB_HEADER).toContain('cancelled');
	});
});

// ─── CB_LINKS ─────────────────────────────────────────────────────────────────

describe('buildCbBlocks — CB_LINKS', () => {
	it('contains series link when seriesPagePath provided', async () => {
		const app = new App();
		const event = makeRecurringEvent();
		const { CB_LINKS } = await buildCbBlocks(
			makeParams(event, makeSettings(), app, { seriesPagePath: 'Meetings/_series/Daily Standup.md' }),
		);
		expect(CB_LINKS).toContain('[[Daily Standup]]');
	});

	it('does not contain series link when no seriesPagePath', async () => {
		const app = new App();
		const { CB_LINKS } = await buildCbBlocks(makeParams(makeEvent(), makeSettings(), app));
		expect(CB_LINKS).not.toContain('Series:');
	});

	it('contains ## Links heading', async () => {
		const app = new App();
		const { CB_LINKS } = await buildCbBlocks(makeParams(makeEvent(), makeSettings(), app));
		expect(CB_LINKS).toContain('## Links');
	});
});

// ─── CB_CONTEXT / CB_ACTIONS — non-recurring ─────────────────────────────────

describe('buildCbBlocks — CB_CONTEXT / CB_ACTIONS (non-recurring)', () => {
	it('CB_CONTEXT is empty string for non-recurring events', async () => {
		const app = new App();
		const { CB_CONTEXT } = await buildCbBlocks(makeParams(makeEvent(), makeSettings(), app));
		expect(CB_CONTEXT).toBe('');
	});

	it('CB_ACTIONS is empty string for non-recurring events', async () => {
		const app = new App();
		const { CB_ACTIONS } = await buildCbBlocks(makeParams(makeEvent(), makeSettings(), app));
		expect(CB_ACTIONS).toBe('');
	});
});

// ─── CB_CONTEXT / CB_ACTIONS — recurring (redirect) ─────────────────────────

describe('buildCbBlocks — CB_CONTEXT / CB_ACTIONS (recurring, redirect)', () => {
	it('CB_CONTEXT is a redirect blockquote when seriesPagePath is provided', async () => {
		const app = new App();
		const event = makeRecurringEvent();
		const params = makeParams(event, makeSettings(), app);
		params.seriesPagePath = 'Meetings/_series/daily-standup.md';

		const { CB_CONTEXT } = await buildCbBlocks(params);
		expect(CB_CONTEXT).toMatch(/> Aggregated context is in the series note:/);
		expect(CB_CONTEXT).toContain('[[Meetings/_series/daily-standup.md]]');
	});

	it('CB_ACTIONS is a redirect blockquote when seriesPagePath is provided', async () => {
		const app = new App();
		const event = makeRecurringEvent();
		const params = makeParams(event, makeSettings(), app);
		params.seriesPagePath = 'Meetings/_series/daily-standup.md';

		const { CB_ACTIONS } = await buildCbBlocks(params);
		expect(CB_ACTIONS).toMatch(/> Open series actions are tracked in the series note:/);
		expect(CB_ACTIONS).toContain('[[Meetings/_series/daily-standup.md]]');
	});

	it('CB_CONTEXT falls back to generic redirect when no seriesPagePath', async () => {
		const app = new App();
		const event = makeRecurringEvent();
		const { CB_CONTEXT } = await buildCbBlocks(makeParams(event, makeSettings(), app));
		expect(CB_CONTEXT).toMatch(/> See the series note/);
	});

	it('CB_ACTIONS falls back to generic redirect when no seriesPagePath', async () => {
		const app = new App();
		const event = makeRecurringEvent();
		const { CB_ACTIONS } = await buildCbBlocks(makeParams(event, makeSettings(), app));
		expect(CB_ACTIONS).toMatch(/> See the series note/);
	});
});

// ─── Placeholder slots ────────────────────────────────────────────────────────

describe('buildCbBlocks — placeholder slots', () => {
	it('CB_BODY is always empty string', async () => {
		const app = new App();
		const { CB_BODY } = await buildCbBlocks(makeParams(makeEvent(), makeSettings(), app));
		expect(CB_BODY).toBe('');
	});

	it('CB_DECISIONS is always empty string', async () => {
		const app = new App();
		const { CB_DECISIONS } = await buildCbBlocks(makeParams(makeEvent(), makeSettings(), app));
		expect(CB_DECISIONS).toBe('');
	});

	it('CB_FOOTER is always empty string', async () => {
		const app = new App();
		const { CB_FOOTER } = await buildCbBlocks(makeParams(makeEvent(), makeSettings(), app));
		expect(CB_FOOTER).toBe('');
	});
});

// ─── CB_DIAGNOSTICS ───────────────────────────────────────────────────────────

describe('buildCbBlocks — CB_DIAGNOSTICS', () => {
	it('CB_DIAGNOSTICS is empty when debugEnabled=false', async () => {
		const app = new App();
		const { CB_DIAGNOSTICS } = await buildCbBlocks(
			makeParams(makeEvent(), makeSettings(), app, { debugEnabled: false }),
		);
		expect(CB_DIAGNOSTICS).toBe('');
	});

	it('CB_DIAGNOSTICS contains trace info when debugEnabled=true', async () => {
		const app = new App();
		const event = makeEvent({ title: 'Debug Test Meeting' });
		const { CB_DIAGNOSTICS } = await buildCbBlocks(
			makeParams(event, makeSettings(), app, { debugEnabled: true }),
		);
		expect(CB_DIAGNOSTICS).toContain('CB Diagnostics');
		expect(CB_DIAGNOSTICS).toContain('Debug Test Meeting');
	});
});

// ─── CB_SERIES_LINK ──────────────────────────────────────────────────────────

describe('buildCbBlocks — CB_SERIES_LINK', () => {
	it('CB_SERIES_LINK contains wikilink for recurring events with seriesPagePath', async () => {
		const app = new App();
		const event = makeRecurringEvent();
		const params = makeParams(event, makeSettings(), app);
		params.seriesPagePath = 'Meetings/_series/daily-standup.md';

		const { CB_SERIES_LINK } = await buildCbBlocks(params);
		expect(CB_SERIES_LINK).toBe('Related series: [[Meetings/_series/daily-standup.md]]');
	});

	it('CB_SERIES_LINK is empty for non-recurring events', async () => {
		const app = new App();
		const { CB_SERIES_LINK } = await buildCbBlocks(makeParams(makeEvent(), makeSettings(), app));
		expect(CB_SERIES_LINK).toBe('');
	});

	it('CB_SERIES_LINK is empty for recurring events without seriesPagePath', async () => {
		const app = new App();
		const event = makeRecurringEvent();
		const { CB_SERIES_LINK } = await buildCbBlocks(makeParams(event, makeSettings(), app));
		expect(CB_SERIES_LINK).toBe('');
	});
});
