/**
 * FilterStore — mirrors the panel filter fields from PluginSettings.
 * Reads/writes via plugin.saveSettings(). Exposes activeFilterCount().
 */

import { PluginSettings } from '../../../types';

export interface FilterState {
	panelHorizonDays: number;
	panelIncludeAllDay: boolean;
	panelIncludeDeclined: boolean;
	panelOnlyWithAttendees: boolean;
	panelSkipShorterThanMin: number;
	panelExtractConferenceLinks: boolean;
	panelExtractAttendees: boolean;
	panelExtractLocation: boolean;
	panelExcludeTitles: string;
	panelIncludeTitles: string;
	panelTitleRegexMode: boolean;
}

// Default values for comparison to compute activeFilterCount
const FILTER_DEFAULTS: FilterState = {
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

export type FilterStoreListener = (state: FilterState) => void;

export class FilterStore {
	private state: FilterState;
	private listeners: Set<FilterStoreListener> = new Set();
	private saveSettingsFn: (partial: Partial<PluginSettings>) => Promise<void>;

	constructor(
		settings: PluginSettings,
		saveSettingsFn: (partial: Partial<PluginSettings>) => Promise<void>,
	) {
		this.state = this.extract(settings);
		this.saveSettingsFn = saveSettingsFn;
	}

	private extract(s: PluginSettings): FilterState {
		return {
			panelHorizonDays: s.panelHorizonDays,
			panelIncludeAllDay: s.panelIncludeAllDay,
			panelIncludeDeclined: s.panelIncludeDeclined,
			panelOnlyWithAttendees: s.panelOnlyWithAttendees,
			panelSkipShorterThanMin: s.panelSkipShorterThanMin,
			panelExtractConferenceLinks: s.panelExtractConferenceLinks,
			panelExtractAttendees: s.panelExtractAttendees,
			panelExtractLocation: s.panelExtractLocation,
			panelExcludeTitles: s.panelExcludeTitles,
			panelIncludeTitles: s.panelIncludeTitles,
			panelTitleRegexMode: s.panelTitleRegexMode,
		};
	}

	getState(): FilterState {
		return { ...this.state };
	}

	/** Number of filter fields that differ from their defaults. */
	activeFilterCount(): number {
		return (Object.keys(FILTER_DEFAULTS) as (keyof FilterState)[]).filter(
			k => this.state[k] !== FILTER_DEFAULTS[k],
		).length;
	}

	subscribe(listener: FilterStoreListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async update(partial: Partial<FilterState>): Promise<void> {
		this.state = { ...this.state, ...partial };
		await this.saveSettingsFn(partial);
		for (const fn of this.listeners) {
			fn(this.getState());
		}
	}

	async reset(): Promise<void> {
		await this.update({ ...FILTER_DEFAULTS });
	}
}
