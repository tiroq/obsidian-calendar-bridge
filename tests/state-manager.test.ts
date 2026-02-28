import {
	StateManager,
	PersistedState,
	emptySubscriptions,
	emptyCache,
	loadPersistedState,
} from '../src/state/state-manager';
import { SeriesProfile } from '../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<SeriesProfile> = {}): SeriesProfile {
	return {
		seriesKey:  'ical:standup-001',
		seriesName: 'Daily Standup',
		enabled:    true,
		...overrides,
	};
}

function makeSM(initial: Partial<PersistedState> = {}): {
	sm: StateManager;
	saveFn: jest.Mock;
	saved: () => PersistedState | null;
} {
	let lastSaved: PersistedState | null = null;
	const saveFn = jest.fn(async (s: PersistedState) => { lastSaved = s; });
	const sm = new StateManager(
		loadPersistedState(initial),
		saveFn,
	);
	return { sm, saveFn, saved: () => lastSaved };
}

// ─── loadPersistedState ───────────────────────────────────────────────────────

describe('loadPersistedState', () => {
	it('returns empty subscriptions and cache for null input', () => {
		const state = loadPersistedState(null);
		expect(state.subscriptions).toEqual(emptySubscriptions());
		expect(state.cache).toEqual(emptyCache());
	});

	it('returns defaults for an empty object', () => {
		const state = loadPersistedState({});
		expect(state.subscriptions.version).toBe(1);
		expect(state.subscriptions.profiles).toEqual({});
		expect(state.cache.icsCache).toEqual({});
		expect(state.cache.eventToPath).toEqual({});
	});

	it('preserves existing subscriptions from raw data', () => {
		const raw = {
			subscriptions: {
				version: 1,
				profiles: {
					'ical:standup': {
						seriesKey: 'ical:standup',
						seriesName: 'Standup',
						enabled: true,
					},
				},
			},
		};
		const state = loadPersistedState(raw);
		expect(state.subscriptions.profiles['ical:standup'].seriesName).toBe('Standup');
		expect(state.cache).toEqual(emptyCache());
	});

	it('preserves existing cache from raw data', () => {
		const raw = {
			cache: {
				version: 1,
				icsCache: {},
				eventToPath: { 'evt-001': 'Meetings/2024-01-15 Meeting.md' },
			},
		};
		const state = loadPersistedState(raw);
		expect(state.cache.eventToPath['evt-001']).toBe('Meetings/2024-01-15 Meeting.md');
		expect(state.subscriptions).toEqual(emptySubscriptions());
	});
});

// ─── emptySubscriptions / emptyCache ─────────────────────────────────────────

describe('emptySubscriptions', () => {
	it('returns version 1 with empty profiles', () => {
		const s = emptySubscriptions();
		expect(s.version).toBe(1);
		expect(s.profiles).toEqual({});
	});
});

describe('emptyCache', () => {
	it('returns version 1 with empty maps', () => {
		const c = emptyCache();
		expect(c.version).toBe(1);
		expect(c.icsCache).toEqual({});
		expect(c.eventToPath).toEqual({});
	});
});

// ─── StateManager constructor ─────────────────────────────────────────────────

describe('StateManager — constructor', () => {
	it('initializes with empty state when raw is empty', () => {
		const { sm } = makeSM();
		expect(sm.getSubscriptions()).toEqual(emptySubscriptions());
		expect(sm.getCache()).toEqual(emptyCache());
	});

	it('restores profiles from initial state', () => {
		const profile = makeProfile();
		const { sm } = makeSM({
			subscriptions: { version: 1, profiles: { [profile.seriesKey]: profile } },
		});
		expect(sm.getProfile(profile.seriesKey)).toEqual(profile);
	});

	it('restores cache from initial state', () => {
		const { sm } = makeSM({
			cache: { version: 1, icsCache: {}, eventToPath: { 'evt-1': 'path/note.md' } },
		});
		expect(sm.findNotePath('evt-1')).toBe('path/note.md');
	});
});

// ─── getProfile / isEnabled ───────────────────────────────────────────────────

describe('StateManager — getProfile / isEnabled', () => {
	it('returns undefined for unknown seriesKey', () => {
		const { sm } = makeSM();
		expect(sm.getProfile('ical:unknown')).toBeUndefined();
	});

	it('returns false for isEnabled on unknown key', () => {
		const { sm } = makeSM();
		expect(sm.isEnabled('ical:unknown')).toBe(false);
	});

	it('returns the stored profile for a known key', () => {
		const profile = makeProfile({ seriesName: 'Weekly Review' });
		const { sm } = makeSM({
			subscriptions: { version: 1, profiles: { [profile.seriesKey]: profile } },
		});
		expect(sm.getProfile(profile.seriesKey)?.seriesName).toBe('Weekly Review');
	});

	it('returns true for isEnabled when profile.enabled = true', () => {
		const profile = makeProfile({ enabled: true });
		const { sm } = makeSM({
			subscriptions: { version: 1, profiles: { [profile.seriesKey]: profile } },
		});
		expect(sm.isEnabled(profile.seriesKey)).toBe(true);
	});

	it('returns false for isEnabled when profile.enabled = false', () => {
		const profile = makeProfile({ enabled: false });
		const { sm } = makeSM({
			subscriptions: { version: 1, profiles: { [profile.seriesKey]: profile } },
		});
		expect(sm.isEnabled(profile.seriesKey)).toBe(false);
	});
});

// ─── enableSeries ─────────────────────────────────────────────────────────────

describe('StateManager — enableSeries', () => {
	it('creates a new enabled profile for an unknown key', async () => {
		const { sm, saveFn } = makeSM();
		await sm.enableSeries('ical:new-series', 'New Series');
		const profile = sm.getProfile('ical:new-series');
		expect(profile).toBeDefined();
		expect(profile?.enabled).toBe(true);
		expect(profile?.seriesName).toBe('New Series');
		expect(saveFn).toHaveBeenCalledTimes(1);
	});

	it('enables an existing disabled profile without duplicating it', async () => {
		const profile = makeProfile({ enabled: false });
		const { sm, saveFn } = makeSM({
			subscriptions: { version: 1, profiles: { [profile.seriesKey]: profile } },
		});
		await sm.enableSeries(profile.seriesKey, profile.seriesName);
		expect(sm.isEnabled(profile.seriesKey)).toBe(true);
		expect(Object.keys(sm.getSubscriptions().profiles)).toHaveLength(1);
		expect(saveFn).toHaveBeenCalledTimes(1);
	});

	it('calls saveFn with the updated state', async () => {
		const { sm, saved } = makeSM();
		await sm.enableSeries('ical:x', 'X');
		expect(saved()?.subscriptions.profiles['ical:x']?.enabled).toBe(true);
	});
});

// ─── disableSeries ────────────────────────────────────────────────────────────

describe('StateManager — disableSeries', () => {
	it('sets enabled = false for an existing profile', async () => {
		const profile = makeProfile({ enabled: true });
		const { sm, saveFn } = makeSM({
			subscriptions: { version: 1, profiles: { [profile.seriesKey]: profile } },
		});
		await sm.disableSeries(profile.seriesKey);
		expect(sm.isEnabled(profile.seriesKey)).toBe(false);
		expect(saveFn).toHaveBeenCalledTimes(1);
	});

	it('is a no-op for an unknown key (does not save)', async () => {
		const { sm, saveFn } = makeSM();
		await sm.disableSeries('ical:nonexistent');
		expect(saveFn).not.toHaveBeenCalled();
	});
});

// ─── upsertProfile ────────────────────────────────────────────────────────────

describe('StateManager — upsertProfile', () => {
	it('inserts a new profile', async () => {
		const { sm, saveFn } = makeSM();
		const profile = makeProfile({ seriesName: 'Planning' });
		await sm.upsertProfile(profile);
		expect(sm.getProfile(profile.seriesKey)?.seriesName).toBe('Planning');
		expect(saveFn).toHaveBeenCalledTimes(1);
	});

	it('overwrites an existing profile completely', async () => {
		const profile = makeProfile({ seriesName: 'Old Name', tags: ['old'] });
		const { sm } = makeSM({
			subscriptions: { version: 1, profiles: { [profile.seriesKey]: profile } },
		});
		const updated = { ...profile, seriesName: 'New Name', tags: ['new'] };
		await sm.upsertProfile(updated);
		const stored = sm.getProfile(profile.seriesKey)!;
		expect(stored.seriesName).toBe('New Name');
		expect(stored.tags).toEqual(['new']);
	});

	it('stores a deep copy (mutating the original does not affect state)', async () => {
		const { sm } = makeSM();
		const profile = makeProfile();
		await sm.upsertProfile(profile);
		profile.seriesName = 'mutated';
		expect(sm.getProfile(profile.seriesKey)?.seriesName).toBe('Daily Standup');
	});
});

// ─── enabledProfiles ─────────────────────────────────────────────────────────

describe('StateManager — enabledProfiles', () => {
	it('returns empty array when no profiles exist', () => {
		const { sm } = makeSM();
		expect(sm.enabledProfiles()).toEqual([]);
	});

	it('only includes enabled profiles', async () => {
		const { sm } = makeSM();
		await sm.enableSeries('ical:a', 'Alpha');
		await sm.enableSeries('ical:b', 'Beta');
		await sm.disableSeries('ical:b');
		const enabled = sm.enabledProfiles();
		expect(enabled).toHaveLength(1);
		expect(enabled[0].seriesKey).toBe('ical:a');
	});

	it('returns profiles sorted by seriesName', async () => {
		const { sm } = makeSM();
		await sm.enableSeries('ical:z', 'Zebra');
		await sm.enableSeries('ical:a', 'Apple');
		await sm.enableSeries('ical:m', 'Mango');
		const names = sm.enabledProfiles().map(p => p.seriesName);
		expect(names).toEqual(['Apple', 'Mango', 'Zebra']);
	});
});

// ─── updateLastSyncAt ─────────────────────────────────────────────────────────

describe('StateManager — updateLastSyncAt', () => {
	it('updates lastSyncAt and calls saveFn', async () => {
		const { sm, saveFn, saved } = makeSM();
		await sm.updateLastSyncAt('2024-01-15T09:00:00Z');
		expect(sm.getCache().lastSyncAt).toBe('2024-01-15T09:00:00Z');
		expect(saveFn).toHaveBeenCalledTimes(1);
		expect(saved()?.cache.lastSyncAt).toBe('2024-01-15T09:00:00Z');
	});
});

// ─── updateIcsCacheEntry ──────────────────────────────────────────────────────

describe('StateManager — updateIcsCacheEntry', () => {
	it('creates a new entry for a new sourceId', async () => {
		const { sm, saveFn } = makeSM();
		await sm.updateIcsCacheEntry('src1', { etag: '"abc"', lastFetched: '2024-01-15T09:00:00Z' });
		const entry = sm.getCache().icsCache['src1'];
		expect(entry.etag).toBe('"abc"');
		expect(entry.lastFetched).toBe('2024-01-15T09:00:00Z');
		expect(saveFn).toHaveBeenCalledTimes(1);
	});

	it('merges into an existing entry without losing other fields', async () => {
		const { sm } = makeSM({
			cache: {
				version: 1,
				icsCache: { src1: { url: 'http://example.com/cal.ics', etag: '"old"' } },
				eventToPath: {},
			},
		});
		await sm.updateIcsCacheEntry('src1', { etag: '"new"' });
		const entry = sm.getCache().icsCache['src1'];
		expect(entry.etag).toBe('"new"');
		expect(entry.url).toBe('http://example.com/cal.ics');
	});
});

// ─── setEventPath / findNotePath / removeEventPath ────────────────────────────

describe('StateManager — setEventPath / findNotePath / removeEventPath', () => {
	it('setEventPath stores a mapping and calls saveFn', async () => {
		const { sm, saveFn } = makeSM();
		await sm.setEventPath('evt-001', 'Meetings/2024-01-15 Standup.md');
		expect(sm.findNotePath('evt-001')).toBe('Meetings/2024-01-15 Standup.md');
		expect(saveFn).toHaveBeenCalledTimes(1);
	});

	it('findNotePath returns undefined for unknown eventId', () => {
		const { sm } = makeSM();
		expect(sm.findNotePath('missing')).toBeUndefined();
	});

	it('findNotePath falls back to uid when eventId is not found', async () => {
		const { sm } = makeSM();
		await sm.setEventPath('uid-abc', 'Meetings/note.md');
		expect(sm.findNotePath('evt-unknown', 'uid-abc')).toBe('Meetings/note.md');
	});

	it('findNotePath prefers eventId over uid', async () => {
		const { sm } = makeSM();
		await sm.setEventPath('evt-001', 'Meetings/by-id.md');
		await sm.setEventPath('uid-001', 'Meetings/by-uid.md');
		expect(sm.findNotePath('evt-001', 'uid-001')).toBe('Meetings/by-id.md');
	});

	it('removeEventPath deletes the mapping and calls saveFn', async () => {
		const { sm, saveFn } = makeSM();
		await sm.setEventPath('evt-001', 'Meetings/note.md');
		saveFn.mockClear();
		await sm.removeEventPath('evt-001');
		expect(sm.findNotePath('evt-001')).toBeUndefined();
		expect(saveFn).toHaveBeenCalledTimes(1);
	});

	it('removeEventPath on unknown key still calls saveFn', async () => {
		const { sm, saveFn } = makeSM();
		await sm.removeEventPath('no-such-key');
		expect(saveFn).toHaveBeenCalledTimes(1);
	});
});

// ─── getSubscriptions / getCache return live references ───────────────────────

describe('StateManager — getSubscriptions / getCache', () => {
	it('getSubscriptions reflects mutations made via enableSeries', async () => {
		const { sm } = makeSM();
		const before = sm.getSubscriptions();
		await sm.enableSeries('ical:x', 'X');
		const after = sm.getSubscriptions();
		// Should reflect the new profile
		expect(after.profiles['ical:x']).toBeDefined();
		// Both references point to the same backing object
		expect(before).toBe(after);
	});
});
