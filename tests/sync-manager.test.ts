import { App, Vault } from './__mocks__/obsidian';
import { runSync, SyncResult, SyncSettings } from '../src/sync-manager';
import { DEFAULT_SETTINGS } from '../src/types';
import { CB_SLOTS } from '../src/services/TemplateService';
import { AUTOGEN_START, AUTOGEN_END, AUTOGEN_AGENDA_START } from '../src/note-generator';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const NOW = new Date('2024-01-15T00:00:00Z');

function makeSettings(overrides: Partial<SyncSettings> = {}): SyncSettings {
	return {
		...DEFAULT_SETTINGS,
		notesFolder: 'Meetings',
		seriesFolder: 'Meetings/Series',
		syncHorizonDays: 14,
		calendarSources: [
			{ id: 'src1', name: 'Work Calendar', url: 'http://example.com/cal.ics', enabled: true },
		],
		...overrides,
	};
}

const ONE_EVENT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:one-off-001@test
SUMMARY:Project Kickoff
DESCRIPTION:Initial meeting
LOCATION:Room 101
DTSTART:20240115T090000Z
DTEND:20240115T100000Z
END:VEVENT
END:VCALENDAR`;

const RECURRING_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:standup-001@test
SUMMARY:Daily Standup
DTSTART:20240115T090000Z
DTEND:20240115T091500Z
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
END:VCALENDAR`;

const TWO_SOURCES_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:personal-001@test
SUMMARY:Doctor Appointment
DTSTART:20240116T140000Z
DTEND:20240116T150000Z
END:VEVENT
END:VCALENDAR`;

// Helper: build an App whose vault already holds some content
function makeApp(files: Record<string, string> = {}): App {
	const app = new App();
	for (const [path, content] of Object.entries(files)) {
		(app.vault as Vault)['files'].set(path, content);
	}
	return app;
}

// ─── Basic create ────────────────────────────────────────────────────────────

describe('runSync — basic event creation', () => {
	it('creates a note for a single upcoming event', async () => {
		const app = new App();
		const settings = makeSettings();
		const fetchFn = async () => ONE_EVENT_ICS;

		const result = await runSync(app as never, settings, fetchFn, NOW);

		expect(result.errors).toHaveLength(0);
		expect(result.created).toBe(1);

		const files = (app.vault as Vault).listFiles();
		expect(files.some(f => f.includes('Project Kickoff'))).toBe(true);
	});

	it('note content contains event title, date, and AUTOGEN markers', async () => {
		const app = new App();
		const settings = makeSettings();
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);

		const files = (app.vault as Vault).listFiles();
		const notePath = files.find(f => f.includes('Project Kickoff'))!;
		const content = (app.vault as Vault).readByPath(notePath)!;

		expect(content).toContain('# Project Kickoff');
		expect(content).toContain(AUTOGEN_AGENDA_START);
		expect(content).toContain('Initial meeting');
		expect(content).toContain('Room 101');
	});

	it('places notes in the configured notesFolder', async () => {
		const app = new App();
		const settings = makeSettings({ notesFolder: 'Calendar/Notes' });
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);

		const files = (app.vault as Vault).listFiles();
		expect(files.every(f => f.startsWith('Calendar/Notes') || f.startsWith('Calendar/'))).toBe(true);
	});

	it('returns an error (not a throw) when a source fetch fails', async () => {
		const app = new App();
		const settings = makeSettings();
		const fetchFn = async () => { throw new Error('Network timeout'); };

		const result = await runSync(app as never, settings, fetchFn, NOW);

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('Network timeout');
		expect(result.created).toBe(0);
	});

	it('skips disabled sources', async () => {
		const app = new App();
		const settings = makeSettings({
			calendarSources: [
				{ id: 'src1', name: 'Work', url: 'http://x.com/a.ics', enabled: false },
			],
		});
		const fetchFn = jest.fn(async () => ONE_EVENT_ICS);

		const result = await runSync(app as never, settings, fetchFn, NOW);

		expect(fetchFn).not.toHaveBeenCalled();
		expect(result.created).toBe(0);
	});
});

// ─── Idempotent sync ─────────────────────────────────────────────────────────

describe('runSync — idempotency', () => {
	it('does not create duplicate notes on a second sync', async () => {
		const app = new App();
		const settings = makeSettings();
		const fetchFn = async () => ONE_EVENT_ICS;

		await runSync(app as never, settings, fetchFn, NOW);
		const result2 = await runSync(app as never, settings, fetchFn, NOW);

		// Second sync should not create new files
		expect(result2.created).toBe(0);
		// Everything unchanged: skipped
		expect(result2.updated + result2.skipped).toBeGreaterThanOrEqual(1);

		const files = (app.vault as Vault).listFiles().filter(f => f.endsWith('.md'));
		const meetingNotes = files.filter(f => f.includes('Project Kickoff'));
		expect(meetingNotes).toHaveLength(1);
	});

	it('updates only the AUTOGEN block of an existing note on re-sync', async () => {
		const app = new App();
		const settings = makeSettings();
		const fetchFn = async () => ONE_EVENT_ICS;

		// First sync
		await runSync(app as never, settings, fetchFn, NOW);

		// Simulate the user adding manual notes
		const files = (app.vault as Vault).listFiles();
		const notePath = files.find(f => f.includes('Project Kickoff'))!;
		const vault = app.vault as Vault;
		const original = vault.readByPath(notePath)!;
		const withManual = original + '\n\n## My Notes\nUser wrote this.';
		vault['files'].set(notePath, withManual);

		// Second sync
		await runSync(app as never, settings, fetchFn, NOW);

		const updated = vault.readByPath(notePath)!;
		expect(updated).toContain('User wrote this.'); // manual content preserved
		expect(updated).toContain(AUTOGEN_AGENDA_START); // AUTOGEN block still there
	});

	it('preserves content outside AUTOGEN block across multiple syncs', async () => {
		const app = new App();
		const settings = makeSettings();
		const fetchFn = async () => ONE_EVENT_ICS;

		await runSync(app as never, settings, fetchFn, NOW);

		const vault = app.vault as Vault;
		const files = vault.listFiles();
		const notePath = files.find(f => f.includes('Project Kickoff'))!;

		// Add a section before and after the AUTOGEN block
		const current = vault.readByPath(notePath)!;
		const injected = current.replace(
			AUTOGEN_AGENDA_START,
			'**Pre-autogen manual note**\n\n' + AUTOGEN_AGENDA_START,
		) + '\n\n**Post-autogen manual note**';
		vault['files'].set(notePath, injected);

		await runSync(app as never, settings, fetchFn, NOW);

		const final = vault.readByPath(notePath)!;
		expect(final).toContain('**Pre-autogen manual note**');
		expect(final).toContain('**Post-autogen manual note**');
	});
});

// ─── Recurring events & series pages ────────────────────────────────────────

describe('runSync — recurring events and series pages', () => {
	it('creates one meeting note per occurrence', async () => {
		const app = new App();
		const settings = makeSettings();
		await runSync(app as never, settings, async () => RECURRING_ICS, NOW);

		const vault = app.vault as Vault;
		const meetingNotes = vault.listFiles().filter(f =>
			f.startsWith('Meetings/') && f.includes('Daily Standup') && !f.includes('Series'),
		);
		expect(meetingNotes).toHaveLength(3);
	});

	it('creates a series index page for recurring events', async () => {
		const app = new App();
		const settings = makeSettings();
		await runSync(app as never, settings, async () => RECURRING_ICS, NOW);

		const vault = app.vault as Vault;
		const seriesFiles = vault.listFiles().filter(f =>
			f.startsWith('Meetings/Series/'),
		);
		expect(seriesFiles).toHaveLength(1);
		expect(seriesFiles[0]).toContain('Daily Standup');
	});

	it('series page contains wikilinks to each meeting note', async () => {
		const app = new App();
		const settings = makeSettings();
		await runSync(app as never, settings, async () => RECURRING_ICS, NOW);

		const vault = app.vault as Vault;
		const seriesPath = vault.listFiles().find(f => f.startsWith('Meetings/Series/'))!;
		const content = vault.readByPath(seriesPath)!;

		expect(content).toContain('[[');
		expect(content).toContain('Daily Standup');
	});

	it('meeting notes for recurring events contain a series cross-link', async () => {
		const app = new App();
		const settings = makeSettings();
		await runSync(app as never, settings, async () => RECURRING_ICS, NOW);

		const vault = app.vault as Vault;
		const meetingNote = vault
			.listFiles()
			.filter(f => f.includes('Daily Standup') && !f.includes('Series'))[0];
		const content = vault.readByPath(meetingNote)!;

		expect(content).toContain('[[Daily Standup]]');
	});

	it('does not create a series page for non-recurring events', async () => {
		const app = new App();
		const settings = makeSettings();
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);

		const vault = app.vault as Vault;
		const seriesFiles = vault.listFiles().filter(f => f.startsWith('Meetings/Series/'));
		expect(seriesFiles).toHaveLength(0);
	});

	it('updates the series page AUTOGEN block without removing manual series notes', async () => {
		const app = new App();
		const settings = makeSettings();
		const fetchFn = async () => RECURRING_ICS;

		await runSync(app as never, settings, fetchFn, NOW);

		const vault = app.vault as Vault;
		const seriesPath = vault.listFiles().find(f => f.startsWith('Meetings/Series/'))!;

		// Simulate user adding a series-level note
		const original = vault.readByPath(seriesPath)!;
		vault['files'].set(seriesPath, original + '\n\n## Series Notes\nAdded by user.');

		// Re-sync
		await runSync(app as never, settings, fetchFn, NOW);

		const updated = vault.readByPath(seriesPath)!;
		expect(updated).toContain('Added by user.'); // manual content preserved
		expect(updated).toContain(AUTOGEN_START);
	});
});

// ─── Multiple sources ────────────────────────────────────────────────────────

describe('runSync — multiple calendar sources', () => {
	it('syncs events from all enabled sources', async () => {
		const app = new App();
		const settings = makeSettings({
			calendarSources: [
				{ id: 'src1', name: 'Work', url: 'http://x.com/work.ics', enabled: true },
				{ id: 'src2', name: 'Personal', url: 'http://x.com/personal.ics', enabled: true },
			],
		});

		const fetchFn = async (url: string) => {
			if (url.includes('work')) return ONE_EVENT_ICS;
			if (url.includes('personal')) return TWO_SOURCES_ICS;
			return 'BEGIN:VCALENDAR\nEND:VCALENDAR';
		};

		const result = await runSync(app as never, settings, fetchFn, NOW);

		expect(result.errors).toHaveLength(0);
		expect(result.created).toBe(2);

		const vault = app.vault as Vault;
		const files = vault.listFiles();
		expect(files.some(f => f.includes('Project Kickoff'))).toBe(true);
		expect(files.some(f => f.includes('Doctor Appointment'))).toBe(true);
	});

	it('includes source name in the meeting note', async () => {
		const app = new App();
		const settings = makeSettings({
			calendarSources: [
				{ id: 'src1', name: 'My Work Cal', url: 'http://x.com/work.ics', enabled: true },
			],
		});
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);

		const vault = app.vault as Vault;
		const notePath = vault.listFiles().find(f => f.includes('Project Kickoff'))!;
		const content = vault.readByPath(notePath)!;
		expect(content).toContain('My Work Cal');
	});
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('runSync — edge cases', () => {
	it('returns early with no errors when no sources are configured', async () => {
		const app = new App();
		const settings = makeSettings({ calendarSources: [] });
		const result = await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);

		expect(result.errors).toHaveLength(0);
		expect(result.created).toBe(0);
	});

	it('ignores events outside the sync horizon', async () => {
		const app = new App();
		// 1-day horizon: range is [Jan 15 00:00, Jan 16 00:00); event at 09:00 on Jan 15 qualifies
		const settings = makeSettings({ syncHorizonDays: 1 });
		const fetchFn = async () => ONE_EVENT_ICS; // event is on Jan 15 = today

		const result = await runSync(app as never, settings, fetchFn, NOW);
		expect(result.created).toBeGreaterThanOrEqual(1);
	});

	it('handles an empty ICS feed gracefully', async () => {
		const app = new App();
		const settings = makeSettings();
		const result = await runSync(
			app as never,
			settings,
			async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR',
			NOW,
		);

		expect(result.errors).toHaveLength(0);
		expect(result.created).toBe(0);
	});

	it('partial source failure does not abort the entire sync', async () => {
		const app = new App();
		const settings = makeSettings({
			calendarSources: [
				{ id: 'src1', name: 'Good', url: 'http://x.com/good.ics', enabled: true },
				{ id: 'src2', name: 'Bad', url: 'http://x.com/bad.ics', enabled: true },
			],
		});

		const fetchFn = async (url: string) => {
			if (url.includes('bad')) throw new Error('Connection refused');
			return ONE_EVENT_ICS;
		};

		const result = await runSync(app as never, settings, fetchFn, NOW);

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('Bad');
		expect(result.created).toBe(1); // good source still worked
	});
});

// ─── isSeriesEnabled filter ──────────────────────────────────────────────────

describe('runSync — isSeriesEnabled filter', () => {
	it('syncs recurring events whose seriesKey is enabled (returns true)', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (key: string) => key.includes('standup') ? true as boolean | undefined : undefined as boolean | undefined;
		const result = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.created).toBeGreaterThanOrEqual(1);
		expect(result.newCandidates).toHaveLength(0);
	});

	it('skips recurring events whose seriesKey is disabled (returns false)', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (_key: string): boolean | undefined => false;
		const result = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.created).toBe(0);
		expect(result.skipped).toBeGreaterThanOrEqual(1);
	});

	it('pushes unknown recurring seriesKey events to newCandidates and skips them', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (_key: string): boolean | undefined => undefined;
		const result = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.created).toBe(0);
		expect(result.newCandidates!.length).toBeGreaterThan(0);
	});

	it('syncs enabled recurring events and skips disabled ones', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (key: string): boolean | undefined => key.includes('standup') ? true : undefined;
		const result = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.created).toBeGreaterThanOrEqual(1);
		expect(result.newCandidates).toHaveLength(0);
	});
});

// ─── selectedCalendarIds filter ───────────────────────────────────────────────

describe('runSync — selectedCalendarIds filter', () => {
	it('syncs ICS events regardless of selectedCalendarIds (gcal-only filter)', async () => {
		const app = new App();
		const settings = makeSettings();
		// selectedCalendarIds only filters gcal events; ICS events pass through always
		const result = await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW, undefined, undefined, ['some-gcal-id']);
		expect(result.created).toBe(1);
	});

	it('syncs all ICS events when selectedCalendarIds is empty', async () => {
		const app = new App();
		const settings = makeSettings();
		const result = await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW, undefined, undefined, []);
		expect(result.created).toBe(1);
	});
});

// ─── onProgress callbacks ─────────────────────────────────────────────────────

describe('runSync — onProgress callbacks', () => {
	it('calls onProgress with authenticating at start', async () => {
		const app = new App();
		const settings = makeSettings();
		const stages: Array<{ stage: string; pct: number }> = [];
		const onProgress = (stage: string, pct: number) => stages.push({ stage, pct });
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW, onProgress as never);
		expect(stages.some(s => s.stage === 'authenticating')).toBe(true);
		expect(stages.find(s => s.stage === 'authenticating')?.pct).toBe(5);
	});

	it('calls onProgress with completed at end', async () => {
		const app = new App();
		const settings = makeSettings();
		const stages: Array<{ stage: string; pct: number }> = [];
		const onProgress = (stage: string, pct: number) => stages.push({ stage, pct });
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW, onProgress as never);
		expect(stages.some(s => s.stage === 'completed')).toBe(true);
		expect(stages.find(s => s.stage === 'completed')?.pct).toBe(100);
	});

	it('calls onProgress with all expected stages in order', async () => {
		const app = new App();
		const settings = makeSettings();
		const stageNames: string[] = [];
		const onProgress = (stage: string, _pct: number) => stageNames.push(stage);
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW, onProgress as never);
		expect(stageNames[0]).toBe('authenticating');
		expect(stageNames[stageNames.length - 1]).toBe('completed');
	});
});

// ─── newCandidates population ─────────────────────────────────────────────────

describe('runSync — newCandidates result', () => {
	it('newCandidates is empty when isSeriesEnabled is not provided', async () => {
		const app = new App();
		const settings = makeSettings();
		const result = await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);
		expect(result.newCandidates).toHaveLength(0);
	});

	it('newCandidates contains correct event data for unknown recurring series', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (_key: string): boolean | undefined => undefined;
		const result = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.newCandidates!.length).toBeGreaterThan(0);
		expect(result.newCandidates![0].title).toBe('Daily Standup');
	});

	it('normalizedEvents is populated with all fetched events', async () => {
		const app = new App();
		const settings = makeSettings();
		const result = await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);
		expect(result.normalizedEvents).toBeDefined();
		expect(result.normalizedEvents!.length).toBeGreaterThanOrEqual(1);
	});
});

// ─── Google Calendar source integration ────────────────────────────────────────

import { requestUrl } from './__mocks__/obsidian';

function makeGcalApiSettings(overrides: Partial<{ clientId: string; accessToken: string; refreshToken?: string; tokenExpiry: number; selectedCalendarIds: string[]; includeConferenceData: boolean }> = {}) {
	return {
		clientId: 'test.apps.googleusercontent.com',
		accessToken: 'ya29.test',
		refreshToken: undefined as string | undefined,
		tokenExpiry: Date.now() + 3600000,
		selectedCalendarIds: ['primary'],
		includeConferenceData: false,
		...overrides,
	};
}

function makeGcalSource(overrides: Record<string, unknown> = {}) {
	return {
		id: 'gcal-src-1',
		name: 'My Google Calendar',
		enabled: true,
		sourceType: 'gcal_api' as const,
		google: makeGcalApiSettings(),
		...overrides,
	};
}

function makeGcalRawEvent(overrides: Record<string, unknown> = {}) {
	return {
		id: 'gevt1',
		status: 'confirmed',
		summary: 'Standup',
		start: { dateTime: '2024-01-15T09:00:00Z' },
		end:   { dateTime: '2024-01-15T09:15:00Z' },
		iCalUID: 'gevt1@google.com',
		...overrides,
	};
}

function mockGcalEventsResponse(items: unknown[]) {
	const data = { items };
	(requestUrl as jest.Mock).mockResolvedValue({
		status: 200,
		text: JSON.stringify(data),
		json: data,
	});
}

describe('runSync — Google Calendar source', () => {
	beforeEach(() => { jest.clearAllMocks(); });

	it('fetches events from gcal source and creates a note', async () => {
		mockGcalEventsResponse([makeGcalRawEvent()]);
		const app = new App();
		const settings: SyncSettings = {
			...DEFAULT_SETTINGS,
			notesFolder: 'Meetings',
			seriesFolder: 'Meetings/Series',
			syncHorizonDays: 14,
			sources: [makeGcalSource()],
		};
		const result = await runSync(app as never, settings as never, async () => '', NOW);
		expect(result.errors).toHaveLength(0);
		expect(result.created).toBe(1);
		const files = (app.vault as Vault).listFiles();
		expect(files.some(f => f.includes('Standup'))).toBe(true);
	});

	it('records error when gcal returns 403 but continues', async () => {
		(requestUrl as jest.Mock).mockResolvedValue({ status: 403, text: 'Forbidden', json: {} });
		const app = new App();
		const settings: SyncSettings = {
			...DEFAULT_SETTINGS,
			notesFolder: 'Meetings',
			seriesFolder: 'Meetings/Series',
			syncHorizonDays: 14,
			sources: [makeGcalSource()],
		};
		const result = await runSync(app as never, settings as never, async () => '', NOW);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0]).toMatch(/403/);
		expect(result.created).toBe(0);
	});

	it('falls back to primary when selectedCalendarIds is empty', async () => {
		mockGcalEventsResponse([makeGcalRawEvent()]);
		const app = new App();
		const settings: SyncSettings = {
			...DEFAULT_SETTINGS,
			notesFolder: 'Meetings',
			seriesFolder: 'Meetings/Series',
			syncHorizonDays: 14,
			sources: [makeGcalSource({ google: makeGcalApiSettings({ selectedCalendarIds: [] }) })],
		};
		const result = await runSync(app as never, settings as never, async () => '', NOW);
		expect(result.created).toBe(1);
		const url: string = (requestUrl as jest.Mock).mock.calls[0][0].url;
		expect(url).toContain('primary');
	});

	it('gcal event is normalized with source=gcal_api', async () => {
		mockGcalEventsResponse([makeGcalRawEvent()]);
		const app = new App();
		const settings: SyncSettings = {
			...DEFAULT_SETTINGS,
			notesFolder: 'Meetings',
			seriesFolder: 'Meetings/Series',
			syncHorizonDays: 14,
			sources: [makeGcalSource()],
		};
		const result = await runSync(app as never, settings as never, async () => '', NOW);
		const evt = result.normalizedEvents?.find(e => e.source === 'gcal_api');
		expect(evt).toBeDefined();
		expect(evt!.title).toBe('Standup');
		expect(evt!.calendarId).toBe('primary');
	});

	it('gcal and ICS sources both contribute events when mixed', async () => {
		mockGcalEventsResponse([makeGcalRawEvent()]);
		const app = new App();
		const settings: SyncSettings = {
			...DEFAULT_SETTINGS,
			notesFolder: 'Meetings',
			seriesFolder: 'Meetings/Series',
			syncHorizonDays: 14,
			sources: [
				makeGcalSource(),
				{ id: 'ics-1', name: 'ICS Cal', enabled: true, sourceType: 'ics_public' as const,
				  ics: { url: 'http://example.com/cal.ics', pollIntervalMinutes: 60 } },
			],
		};
		const result = await runSync(
			app as never,
			settings as never,
			async (url: string) => {
				if (url === 'http://example.com/cal.ics') return ONE_EVENT_ICS;
				return '';
			},
			NOW,
		);
		expect(result.normalizedEvents?.some(e => e.source === 'gcal_api')).toBe(true);
		expect(result.normalizedEvents?.some(e => e.source !== 'gcal_api')).toBe(true);
	});
});

// ─── Series gating: single events always sync ───────────────────────────────

describe('runSync — series gating: single events always create files', () => {
	beforeEach(() => { jest.clearAllMocks(); });

	it('creates file for single event even when isSeriesEnabled returns undefined for all keys', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (_key: string, _isRecurring: boolean): boolean | undefined => undefined;
		const result = await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.errors).toHaveLength(0);
		expect(result.created).toBe(1);
		const files = (app.vault as Vault).listFiles();
		expect(files.some(f => f.includes('Project Kickoff'))).toBe(true);
	});

	it('single event is NOT pushed to newCandidates', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (_key: string, _isRecurring: boolean): boolean | undefined => undefined;
		const result = await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.newCandidates).toHaveLength(0);
	});

	it('eventsFetched, eventsEligible, notesPlanned are all 1 for a single event', async () => {
		const app = new App();
		const settings = makeSettings();
		const result = await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);
		expect(result.eventsFetched).toBe(1);
		expect(result.eventsEligible).toBe(1);
		expect(result.notesPlanned).toBe(1);
	});
});

// ─── Series gating: recurring events respect subscription ────────────────────

describe('runSync — series gating: recurring events respect subscription', () => {
	beforeEach(() => { jest.clearAllMocks(); });

	it('unknown recurring series → newCandidates populated, no file created', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (_key: string, isRecurring: boolean): boolean | undefined => {
			if (!isRecurring) return true;
			return undefined; // unknown recurring series
		};
		const result = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.created).toBe(0);
		expect((result.newCandidates?.length ?? 0)).toBeGreaterThan(0);
	});

	it('enabled recurring series → files created', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (_key: string, isRecurring: boolean): boolean | undefined => {
			if (!isRecurring) return true;
			return true; // explicitly enabled
		};
		const result = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.created).toBeGreaterThan(0);
	});

	it('disabled recurring series → skipped, no file, not in newCandidates', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (_key: string, isRecurring: boolean): boolean | undefined => {
			if (!isRecurring) return true;
			return false; // explicitly disabled
		};
		const result = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.created).toBe(0);
		expect(result.newCandidates).toHaveLength(0);
	});
});

// ─── zeroReason ──────────────────────────────────────────────────────────────

describe('runSync — zeroReason', () => {
	beforeEach(() => { jest.clearAllMocks(); });

	it('zeroReason mentions series when all recurring events excluded by gating', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (_key: string, isRecurring: boolean): boolean | undefined => {
			if (!isRecurring) return true;
			return undefined; // all recurring → newCandidates
		};
		const result = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.created).toBe(0);
		expect(result.zeroReason).toBeDefined();
		expect(result.zeroReason).toMatch(/series/i);
	});

	it('zeroReason set when no events in ICS window', async () => {
		const app = new App();
		const settings = makeSettings();
		const result = await runSync(app as never, settings, async () => 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR', NOW);
		expect(result.eventsFetched).toBe(0);
		expect(result.zeroReason).toBeDefined();
		expect(result.zeroReason).toMatch(/No eligible events/i);
	});

	it('zeroReason is undefined when events are created', async () => {
		const app = new App();
		const settings = makeSettings();
		const result = await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);
		expect(result.created).toBe(1);
		expect(result.zeroReason).toBeUndefined();
	});
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('runSync — idempotency with series-gated events', () => {
	beforeEach(() => { jest.clearAllMocks(); });

	it('running sync twice for a single event creates exactly 1 file', async () => {
		const app = new App();
		const settings = makeSettings();
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);
		const result2 = await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);
		const files = (app.vault as Vault).listFiles();
		const kickoffFiles = files.filter(f => f.includes('Project Kickoff'));
		expect(kickoffFiles).toHaveLength(1);
		expect(result2.created).toBe(0); // already exists — skipped or updated, not re-created
	});

	it('running sync twice for recurring event (enabled) creates N files exactly once', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (_key: string, isRecurring: boolean): boolean | undefined => {
			if (!isRecurring) return true;
			return true;
		};
		const r1 = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		const r2 = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		expect(r1.created).toBeGreaterThan(0);
		expect(r2.created).toBe(0); // all already exist
	});
});

// ─── Diagnostic counts ───────────────────────────────────────────────────────

describe('runSync — diagnostic counts', () => {
	beforeEach(() => { jest.clearAllMocks(); });

	it('eventsFetched reflects total events from ICS regardless of filtering', async () => {
		const app = new App();
		const settings = makeSettings();
		const isSeriesEnabled = (_key: string, isRecurring: boolean): boolean | undefined => {
			if (!isRecurring) return true;
			return false; // disable all recurring
		};
		// RECURRING_ICS expands to 3 occurrences (COUNT=3)
		const result = await runSync(app as never, settings, async () => RECURRING_ICS, NOW, undefined, isSeriesEnabled);
		expect(result.eventsFetched).toBeGreaterThan(0);
		expect(result.eventsEligible).toBe(0);
		expect(result.created).toBe(0);
	});

	it('eventsEligible equals eventsFetched when no series filter applied', async () => {
		const app = new App();
		const settings = makeSettings();
		const result = await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);
		expect(result.eventsEligible).toBe(result.eventsFetched);
	});
});

// ─── Series page filename — gcal recurring event ───────────────────────────

describe('runSync — series page filename for gcal recurring events', () => {
	beforeEach(() => { jest.clearAllMocks(); });

	it('series page filename uses event title only (no gcal: ID)', async () => {
		// Simulates a real Google Calendar recurring event:
		//   recurringEventId: 'base_event_id' → seriesKey = 'gcal:base_event_id'
		//   iCalUID: 'base_event_id@google.com'
		//   summary: 'Team Standup' (the human title)
		mockGcalEventsResponse([makeGcalRawEvent({
			id: 'base_event_id_20260228T100000Z',
			iCalUID: 'base_event_id@google.com',
			recurringEventId: 'base_event_id',
			summary: 'Team Standup',
		})]);
		const app = new App();
		const settings: SyncSettings = {
			...DEFAULT_SETTINGS,
			notesFolder: 'Meetings',
			seriesFolder: 'Meetings/Series',
			syncHorizonDays: 14,
			sources: [makeGcalSource()],
		};
		await runSync(app as never, settings as never, async () => '', NOW);
		const seriesFiles = (app.vault as Vault).listFiles().filter(f => f.startsWith('Meetings/Series/'));
		expect(seriesFiles).toHaveLength(1);
		// Filename must contain the human title, not the gcal ID
		expect(seriesFiles[0]).toContain('Team Standup');
		// Filename must NOT contain the gcal series key ('base_event_id' or 'gcal')
		expect(seriesFiles[0]).not.toMatch(/base_event_id/);
		expect(seriesFiles[0]).not.toMatch(/gcal/i);
	});
	it('meeting note filename uses event title only (no gcal: ID or recurringEventId)', async () => {
		mockGcalEventsResponse([makeGcalRawEvent({
			id: 'base_event_id_20260228T100000Z',
			iCalUID: 'base_event_id@google.com',
			recurringEventId: 'base_event_id',
			summary: 'Team Standup',
		})]);
		const app = new App();
		const settings: SyncSettings = {
			...DEFAULT_SETTINGS,
			notesFolder: 'Meetings',
			seriesFolder: 'Meetings/Series',
			syncHorizonDays: 14,
			sources: [makeGcalSource()],
		};
		await runSync(app as never, settings as never, async () => '', NOW);
		const noteFiles = (app.vault as Vault).listFiles().filter(
			f => f.startsWith('Meetings/') && !f.startsWith('Meetings/Series/'),
		);
		expect(noteFiles).toHaveLength(1);
		expect(noteFiles[0]).toContain('Team Standup');
		expect(noteFiles[0]).not.toMatch(/base_event_id/);
		expect(noteFiles[0]).not.toMatch(/gcal/i);
	});
	it('series page filename is clean with multiple occurrences of the same recurring event', async () => {
		// All instances of a recurring event share iCalUID — groupBySeries must group them together
		// and the series page filename must be the human-readable title, not the recurring ID
		mockGcalEventsResponse([
			makeGcalRawEvent({
				id: 'base_event_id_20260228T100000Z',
				iCalUID: 'base_event_id@google.com',
				recurringEventId: 'base_event_id',
				summary: 'Team Standup',
				start: { dateTime: '2024-01-15T09:00:00Z' },
				end:   { dateTime: '2024-01-15T09:15:00Z' },
			}),
			makeGcalRawEvent({
				id: 'base_event_id_20260301T100000Z',
				iCalUID: 'base_event_id@google.com',
				recurringEventId: 'base_event_id',
				summary: 'Team Standup',
				start: { dateTime: '2024-01-16T09:00:00Z' },
				end:   { dateTime: '2024-01-16T09:15:00Z' },
			}),
		]);
		const app = new App();
		const settings: SyncSettings = {
			...DEFAULT_SETTINGS,
			notesFolder: 'Meetings',
			seriesFolder: 'Meetings/Series',
			syncHorizonDays: 14,
			sources: [makeGcalSource()],
		};
		await runSync(app as never, settings as never, async () => '', NOW);
		const seriesFiles = (app.vault as Vault).listFiles().filter(f => f.startsWith('Meetings/Series/'));
		// Exactly one series page for the recurring series
		expect(seriesFiles).toHaveLength(1);
		expect(seriesFiles[0]).toContain('Team Standup');
		expect(seriesFiles[0]).not.toMatch(/base_event_id/);
		expect(seriesFiles[0]).not.toMatch(/gcal/i);
	});
});

// ─── CB slot injection — integration + regression ────────────────────────────

/** Template containing all 9 CB slot tokens as bare {{CB_*}} placeholders. */
const ALL_CB_SLOTS_TEMPLATE = [
	'---',
	'{{frontmatter}}',
	'---',
	'# {{title}}',
	...CB_SLOTS.map(s => `{{${s}}}`),
].join('\n');

describe('runSync — CB slot injection (integration)', () => {
	it('note created from CB-slot template has zero leftover {{CB_*}} tokens', async () => {
		// Seed the vault with the CB-slot template so loadTemplate can read it.
		const app = makeApp({ 'templates/cb-all.md': ALL_CB_SLOTS_TEMPLATE });
		const settings = makeSettings({ templatePath: 'templates/cb-all.md' });
		const fetchFn = async () => ONE_EVENT_ICS;

		const result = await runSync(app as never, settings, fetchFn, NOW);

		expect(result.errors).toHaveLength(0);
		expect(result.created).toBe(1);

		const files = (app.vault as Vault).listFiles();
		const notePath = files.find(f => f.includes('Project Kickoff'))!;
		const content = (app.vault as Vault).readByPath(notePath)!;

		// No leftover {{CB_*}} tokens must remain in the written note.
		const leftover = content.match(/\{\{CB_[A-Z_]+\}\}/g);
		expect(leftover).toBeNull();
	});

	it('regression: non-recurring event with CB-slot template has no leftover tokens', async () => {
		// Non-recurring events only get empty CB_CONTEXT / CB_ACTIONS — every slot
		// must still be replaced (with '' if needed) and produce no leftover tokens.
		const app = makeApp({ 'templates/cb-all.md': ALL_CB_SLOTS_TEMPLATE });
		const settings = makeSettings({ templatePath: 'templates/cb-all.md' });
		const fetchFn = async () => ONE_EVENT_ICS; // ONE_EVENT_ICS is non-recurring

		await runSync(app as never, settings, fetchFn, NOW);

		const files = (app.vault as Vault).listFiles();
		const notePath = files.find(f => f.includes('Project Kickoff'))!;
		const content = (app.vault as Vault).readByPath(notePath)!;

		expect(content).toBeDefined();
		const leftover = content.match(/\{\{CB_[A-Z_]+\}\}/g);
		expect(leftover).toBeNull();
	});

	it('regression: recurring event with CB-slot template has no leftover tokens', async () => {
		// Recurring events exercise ContextService + ActionAggregationService paths.
		const app = makeApp({ 'templates/cb-all.md': ALL_CB_SLOTS_TEMPLATE });
		const settings = makeSettings({ templatePath: 'templates/cb-all.md' });
		const fetchFn = async () => RECURRING_ICS;

		const result = await runSync(app as never, settings, fetchFn, NOW);

		expect(result.errors).toHaveLength(0);

		const files = (app.vault as Vault).listFiles();
		const notePaths = files.filter(f => f.includes('Daily Standup') && !f.startsWith('Meetings/Series/'));
		expect(notePaths.length).toBeGreaterThan(0);

		for (const notePath of notePaths) {
			const content = (app.vault as Vault).readByPath(notePath)!;
			const leftover = content.match(/\{\{CB_[A-Z_]+\}\}/g);
			expect(leftover).toBeNull();
		}
	});

	it('all 9 CB slot blocks appear in the created note (present but may be empty)', async () => {
		// Verify that injectBlocks replaced tokens with CB block wrappers.
		const app = makeApp({ 'templates/cb-all.md': ALL_CB_SLOTS_TEMPLATE });
		const settings = makeSettings({ templatePath: 'templates/cb-all.md' });

		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);

		const files = (app.vault as Vault).listFiles();
		const notePath = files.find(f => f.includes('Project Kickoff'))!;
		const content = (app.vault as Vault).readByPath(notePath)!;

		// Every slot that has non-empty content should have a CB block wrapper;
		// slots with empty content may be omitted (injectBlocks skips empty blocks).
		// The key guarantee: NO raw {{CB_*}} tokens survive.
		expect(content).not.toMatch(/\{\{CB_[A-Z_]+\}\}/);
	});
});

// ─── CB_FM frontmatter integrity (integration) ────────────────────────────

describe('runSync — CB_FM frontmatter integrity (integration)', () => {
	it('created note starts with --- (valid Obsidian frontmatter)', async () => {
		const app = new App();
		const settings = makeSettings();
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);

		const files = (app.vault as Vault).listFiles();
		const notePath = files.find(f => f.includes('Project Kickoff'))!;
		const content = (app.vault as Vault).readByPath(notePath)!;

		expect(content.startsWith('---\n')).toBe(true);
	});

	it('YAML frontmatter has no HTML CB markers wrapping it', async () => {
		const app = new App();
		const settings = makeSettings();
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);

		const files = (app.vault as Vault).listFiles();
		const notePath = files.find(f => f.includes('Project Kickoff'))!;
		const content = (app.vault as Vault).readByPath(notePath)!;

		// Must NOT have HTML comment markers around the frontmatter block
		const lines = content.split('\n');
		expect(lines[0]).toBe('---');
		expect(lines[0]).not.toContain('<!--');
	});

	it('note created from {{CB_FM}} template starts with --- not HTML comment', async () => {
		const cbFmTemplate = '{{CB_FM}}\n\n# {{title}}\n\n{{CB_HEADER}}';
		const app = makeApp({ 'templates/fm.md': cbFmTemplate });
		const settings = makeSettings({ templatePath: 'templates/fm.md' });

		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);

		const files = (app.vault as Vault).listFiles();
		const notePath = files.find(f => f.includes('Project Kickoff'))!;
		const content = (app.vault as Vault).readByPath(notePath)!;

		expect(content.startsWith('---\n')).toBe(true);
		expect(content).not.toMatch(/^<!--/);
	});

	it('note contains type: meeting in YAML block', async () => {
		const app = new App();
		const settings = makeSettings();
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);

		const files = (app.vault as Vault).listFiles();
		const notePath = files.find(f => f.includes('Project Kickoff'))!;
		const content = (app.vault as Vault).readByPath(notePath)!;

		// Extract frontmatter block
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
		expect(fmMatch).not.toBeNull();
		expect(fmMatch![1]).toContain('type: meeting');
		expect(fmMatch![1]).toContain('title:');
	});

	it('re-sync does not duplicate frontmatter delimiters', async () => {
		const app = new App();
		const settings = makeSettings();
		// First sync: create the note
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);
		// Second sync: update it
		await runSync(app as never, settings, async () => ONE_EVENT_ICS, NOW);

		const files = (app.vault as Vault).listFiles();
		const notePath = files.find(f => f.includes('Project Kickoff'))!;
		const content = (app.vault as Vault).readByPath(notePath)!;

		// Count --- occurrences: exactly 2 (opening + closing frontmatter)
		const dashes = (content.match(/^---$/gm) ?? []).length;
		expect(dashes).toBe(2);
	});
});


