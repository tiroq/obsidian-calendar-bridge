/**
 * Adapter registry / factory.
 *
 * Given the plugin settings, `buildAdapters()` returns one
 * CalendarSourceAdapter per enabled source config.
 */

import { CalendarSourceConfig, SyncCache } from '../types';
import { CalendarSourceAdapter } from './adapter';
import { IcsSourceAdapter } from './ics-source';
import { GoogleCalendarAdapter } from './gcal-source';

export type { CalendarSourceAdapter } from './adapter';
export { computeSeriesKey } from './adapter';
export { IcsSourceAdapter } from './ics-source';
export { GoogleCalendarAdapter } from './gcal-source';

/**
 * Build an adapter for a single source config.
 * Returns null if the config is disabled or misconfigured.
 *
 * @param config          The source config entry from PluginSettings.
 * @param cache           Current sync cache (for ICS conditional GET headers).
 * @param onSettingsUpdate Callback to persist updated GoogleApiSettings after token refresh.
 */
export function buildAdapter(
	config: CalendarSourceConfig,
	cache: SyncCache,
	onSettingsUpdate: (id: string, updated: Partial<CalendarSourceConfig>) => Promise<void>,
): CalendarSourceAdapter | null {
	if (!config.enabled) return null;

	switch (config.sourceType) {
		case 'ics_public':
		case 'ics_secret': {
			const icsSettings = config.ics;
			if (!icsSettings?.url) return null;
			const cacheEntry = cache.icsCache[config.id];
			return new IcsSourceAdapter({
				id: config.id,
				name: config.name,
				sourceType: config.sourceType,
				url: icsSettings.url,
				cacheEntry,
			});
		}

		case 'gcal_api': {
			const googleSettings = config.google;
			if (!googleSettings) return null;
			return new GoogleCalendarAdapter({
				id: config.id,
				name: config.name,
				settings: googleSettings,
				onSettingsUpdate: async (updated) => {
					await onSettingsUpdate(config.id, { google: updated });
				},
			});
		}

		default:
			return null;
	}
}

/**
 * Build all enabled adapters from the plugin sources list.
 *
 * @param sources         Array of source configs from PluginSettings.
 * @param cache           Current sync cache.
 * @param onSettingsUpdate Callback for persisting token updates.
 */
export function buildAdapters(
	sources: CalendarSourceConfig[],
	cache: SyncCache,
	onSettingsUpdate: (id: string, updated: Partial<CalendarSourceConfig>) => Promise<void>,
): CalendarSourceAdapter[] {
	const adapters: CalendarSourceAdapter[] = [];
	for (const source of sources) {
		const adapter = buildAdapter(source, cache, onSettingsUpdate);
		if (adapter) adapters.push(adapter);
	}
	return adapters;
}
