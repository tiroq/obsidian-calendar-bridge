/**
 * StateManager — persistence layer for subscriptions and sync cache.
 *
 * Two files are stored inside the plugin's data folder (via Plugin.loadData /
 * Plugin.saveData), keyed separately so they can evolve independently.
 *
 * Data shape:
 *   plugin.loadData() / plugin.saveData()  →  { subscriptions, cache }
 */

import { SeriesProfile, SubscriptionsState, SyncCache } from '../types';

// ─── StateManager ─────────────────────────────────────────────────────────────

export class StateManager {
	private subscriptions: SubscriptionsState;
	private cache: SyncCache;

	/** Injected save callback (wraps Plugin.saveData). */
	private saveFn: (state: PersistedState) => Promise<void>;

	constructor(initial: PersistedState, saveFn: (state: PersistedState) => Promise<void>) {
		this.subscriptions = initial.subscriptions ?? emptySubscriptions();
		this.cache = initial.cache ?? emptyCache();
		this.saveFn = saveFn;
	}

	// ─── Subscriptions ────────────────────────────────────────────────────────

	getSubscriptions(): SubscriptionsState {
		return this.subscriptions;
	}

	getProfile(seriesKey: string): SeriesProfile | undefined {
		return this.subscriptions.profiles[seriesKey];
	}

	isEnabled(seriesKey: string): boolean {
		return this.subscriptions.profiles[seriesKey]?.enabled ?? false;
	}

	async upsertProfile(profile: SeriesProfile): Promise<void> {
		this.subscriptions.profiles[profile.seriesKey] = { ...profile };
		await this.persist();
	}

	async enableSeries(seriesKey: string, seriesName: string): Promise<void> {
		const existing = this.subscriptions.profiles[seriesKey];
		if (existing) {
			existing.enabled = true;
		} else {
			this.subscriptions.profiles[seriesKey] = {
				seriesKey,
				seriesName,
				enabled: true,
			};
		}
		await this.persist();
	}

	async disableSeries(seriesKey: string): Promise<void> {
		const existing = this.subscriptions.profiles[seriesKey];
		if (existing) {
			existing.enabled = false;
			await this.persist();
		}
	}

	/** All enabled series profiles, sorted by name. */
	enabledProfiles(): SeriesProfile[] {
		return Object.values(this.subscriptions.profiles)
			.filter(p => p.enabled)
			.sort((a, b) => a.seriesName.localeCompare(b.seriesName));
	}

	// ─── Sync Cache ───────────────────────────────────────────────────────────

	getCache(): SyncCache {
		return this.cache;
	}

	async updateLastSyncAt(iso: string): Promise<void> {
		this.cache.lastSyncAt = iso;
		await this.persist();
	}

	async updateIcsCacheEntry(sourceId: string, entry: {
		etag?: string;
		lastModified?: string;
		lastFetched?: string;
	}): Promise<void> {
		this.cache.icsCache[sourceId] = {
			...this.cache.icsCache[sourceId],
			url: this.cache.icsCache[sourceId]?.url ?? '',
			...entry,
		};
		await this.persist();
	}

	/** Record the mapping from (eventId or uid) → vault note path. */
	async setEventPath(key: string, vaultPath: string): Promise<void> {
		this.cache.eventToPath[key] = vaultPath;
		await this.persist();
	}

	/**
	 * Look up the vault path for an event by its eventId or uid.
	 * The sync engine tries eventId first, then uid.
	 */
	findNotePath(eventId: string, uid?: string): string | undefined {
		return (
			this.cache.eventToPath[eventId] ??
			(uid ? this.cache.eventToPath[uid] : undefined)
		);
	}

	/** Remove a stale event → path mapping (e.g. note was deleted). */
	async removeEventPath(key: string): Promise<void> {
		delete this.cache.eventToPath[key];
		await this.persist();
	}

	// ─── Persistence ──────────────────────────────────────────────────────────

	private async persist(): Promise<void> {
		await this.saveFn({ subscriptions: this.subscriptions, cache: this.cache });
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export interface PersistedState {
	subscriptions: SubscriptionsState;
	cache: SyncCache;
}

export function emptySubscriptions(): SubscriptionsState {
	return { version: 1, profiles: {} };
}

export function emptyCache(): SyncCache {
	return { version: 1, icsCache: {}, eventToPath: {} };
}

/**
 * Load the persisted state from raw plugin data.
 * Handles missing / partial data gracefully.
 */
export function loadPersistedState(raw: unknown): PersistedState {
	const data = (raw as Partial<PersistedState>) ?? {};
	return {
		subscriptions: data.subscriptions ?? emptySubscriptions(),
		cache: data.cache ?? emptyCache(),
	};
}
