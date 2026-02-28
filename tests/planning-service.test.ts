import { buildSyncPlan } from '../src/services/PlanningService';
import { NormalizedEvent } from '../src/types';
import { App } from 'obsidian';

// ─── Vault helper using the obsidian mock ───────────────────────────────────────────────

/** Create a mock App with specific paths pre-populated so getAbstractFileByPath returns TFile. */
function makeApp(existingPaths: string[] = []): App {
	const app = new App() as any;
	for (const p of existingPaths) {
		(app.vault as any).files.set(p, '');
	}
	return app;
}

// ─── Minimal event factory ─────────────────────────────────────────────────────

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
	const base: NormalizedEvent = {
		eventId:    'ev1',
		uid:        'uid1',
		calendarId: 'cal1',
		title:      'Team Standup',
		start:      '2026-03-01T10:00:00+07:00',
		end:        '2026-03-01T10:15:00+07:00',
		startDate:  new Date('2026-03-01T10:00:00+07:00'),
		endDate:    new Date('2026-03-01T10:15:00+07:00'),
		isAllDay:   false,
		isRecurring: true,
		seriesKey:  'gcal:uid1',
		sourceName: 'Work',
		attendees:  [],
		status:     'confirmed',
	};
	return { ...base, ...overrides };
}

function makeSettings() {
	return {
		meetingsRoot:  'Meetings',
		seriesRoot:    'Meetings/_series',
		notesFolder:   'Meetings',
		seriesFolder:  'Meetings/_series',
		dateFolderFormat: 'YYYY-MM-DD',
		fileNameFormat: '{time} [{series}] {title}',
		timezoneDefault: '',
		sources: [],
		horizonDays: 3,
		autoSyncIntervalMinutes: 60,
		syncOnStartup: true,
		templatePath: '',
		templateRoutes: [],
		contactsFolder: '',
		enableSeriesPages: true,
		enablePrevNextLinks: true,
		writeStateInVault: false,
		dateFormat: 'YYYY-MM-DD',
		timeFormat: 'HH:mm',
		redactionMode: false,
		stateVersion: 1,
		panelHorizonDays: 5,
		panelIncludeAllDay: true,
		panelIncludeDeclined: false,
		panelOnlyWithAttendees: false,
		panelSkipShorterThanMin: 0,
		panelExtractConferenceLinks: true,
		panelExtractAttendees: true,
		panelExtractLocation: true,
		panelExcludeTitles: '',
		panelIncludeTitles: '',
		panelTitleRegexMode: false,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PlanningService.buildSyncPlan', () => {
	it('returns "create" for events whose note does not exist', () => {
		const event = makeEvent();
		const items = buildSyncPlan(makeApp([]), {
			events: [event],
			settings: makeSettings(),
		});
		expect(items).toHaveLength(1);
		expect(items[0].action).toBe('create');
		expect(items[0].reason).toBe('new event');
		expect(items[0].path).toBeTruthy();
	});

	it('returns "update" for events whose note already exists', () => {
		const event = makeEvent();
		// First build to discover the path, then replay with that path "existing"
		const discovery = buildSyncPlan(makeApp([]), {
			events: [event],
			settings: makeSettings(),
		});
		const path = discovery[0].path;

		const items = buildSyncPlan(makeApp([path]), {
			events: [event],
			settings: makeSettings(),
		});
		expect(items[0].action).toBe('update');
		expect(items[0].reason).toBe('AUTOGEN refresh');
	});

	it('returns empty array for empty event list', () => {
		expect(buildSyncPlan(makeApp(), { events: [], settings: makeSettings() })).toEqual([]);
	});

	it('handles multiple events — each gets independent action', () => {
		const ev1 = makeEvent({ eventId: 'ev1', title: 'Standup', start: '2026-03-01T10:00:00+07:00' });
		const ev2 = makeEvent({ eventId: 'ev2', title: 'Design Review', start: '2026-03-01T14:00:00+07:00',
			startDate: new Date('2026-03-01T14:00:00+07:00'), endDate: new Date('2026-03-01T15:00:00+07:00') });

		const discovery1 = buildSyncPlan(makeApp([]), {
			events: [ev1],
			settings: makeSettings(),
		});
		const existingPath = discovery1[0].path;

		// ev1 exists, ev2 does not
		const items = buildSyncPlan(makeApp([existingPath]), {
			events: [ev1, ev2],
			settings: makeSettings(),
		});

		expect(items).toHaveLength(2);
		const ev1Item = items.find(i => i.path === existingPath)!;
		const ev2Item = items.find(i => i.path !== existingPath)!;
		expect(ev1Item.action).toBe('update');
		expect(ev2Item.action).toBe('create');
	});

	it('paths are strings (not undefined)', () => {
		const items = buildSyncPlan(makeApp([]), {
			events: [makeEvent()],
			settings: makeSettings(),
		});
		expect(typeof items[0].path).toBe('string');
	});
});
