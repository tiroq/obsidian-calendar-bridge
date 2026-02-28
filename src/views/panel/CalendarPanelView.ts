/**
 * CalendarPanelView — right-sidebar ItemView for Calendar Bridge.
 *
 * VIEW_TYPE_CALENDAR_PANEL = "calendar-bridge-control-panel"
 *
 * Layout (vertically stacked, collapsible sections):
 *   [ Status Header ]   ← always visible
 *   [ Sync Progress ]   ← visible only during sync, auto-hides 3s after completion
 *   [ Calendars ]       ← collapsible
 *   [ Filters ]         ← collapsible
 *   [ Preview ]         ← collapsible
 *   [ Heatmap ]         ← collapsible
 */

import { App, ItemView, WorkspaceLeaf } from 'obsidian';
import { NormalizedEvent, RichCalendarItem, SeriesProfile, SyncStage } from '../../types';
import { GoogleCalendarAdapter } from '../../sources/gcal-source';
import { runSync } from '../../sync-manager';
import { CalendarStore } from './stores/CalendarStore';
import { SyncStore } from './stores/SyncStore';
import { FilterStore } from './stores/FilterStore';
import { StatusHeader } from './sections/StatusHeader';
import { SyncProgress } from './sections/SyncProgress';
import { CalendarsSection } from './sections/CalendarsSection';
import { FiltersSection } from './sections/FiltersSection';
import { PreviewSection } from './sections/PreviewSection';
import { HeatmapSection } from './sections/HeatmapSection';
import { SubscriptionsSection } from './sections/SubscriptionsSection';

export const VIEW_TYPE_CALENDAR_PANEL = 'calendar-bridge-control-panel';

/** Minimal plugin interface required by the panel — avoids circular imports. */
export interface CalendarBridgePanelPlugin {
	app: App;
	settings: import('../../types').PluginSettings;
	saveSettings(): Promise<void>;
	/** Open the plugin settings tab. */
	openSettings(): void;
	/** Subscribe to new-candidate events from sync. Returns unsubscribe fn. */
	subscribeNewCandidates(fn: (items: NormalizedEvent[]) => void): () => void;
	/** Return all subscription profiles. */
	getSubscriptions(): import('../../types').SubscriptionsState;
	/** Enable a series/event by key. */
	enableSeries(key: string, name: string): Promise<void>;
	/** Disable a series/event by key. */
	disableSeries(key: string): Promise<void>;
	/** Upsert a full profile. */
	upsertProfile(profile: SeriesProfile): Promise<void>;
}

export class CalendarPanelView extends ItemView {
	private plugin: CalendarBridgePanelPlugin;

	// Stores
	private calendarStore: CalendarStore | null = null;
	private syncStore!: SyncStore;
	private filterStore!: FilterStore;

	// Sections
	private statusHeader: StatusHeader | null = null;
	private syncProgress: SyncProgress | null = null;
	private calendarsSection: CalendarsSection | null = null;
	private subscriptionsSection: SubscriptionsSection | null = null;
	private filtersSection: FiltersSection | null = null;
	private previewSection: PreviewSection | null = null;
	private heatmapSection: HeatmapSection | null = null;
	/** Unsubscribe from new-candidates notifications from main plugin. */
	private unsubNewCandidates: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: CalendarBridgePanelPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CALENDAR_PANEL;
	}

	getDisplayText(): string {
		return 'Calendar Bridge';
	}

	getIcon(): string {
		return 'calendar';
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow-y:auto;';

		// ── Resolve gcal adapter (first gcal_api source, if any) ───────────────
		const gcalSource = this.plugin.settings.sources.find(s => s.sourceType === 'gcal_api' && s.enabled);

		let gcalAdapter: GoogleCalendarAdapter | null = null;
		if (gcalSource?.google) {
			gcalAdapter = new GoogleCalendarAdapter({
				id: gcalSource.id,
				name: gcalSource.name,
				settings: gcalSource.google,
				onSettingsUpdate: async (updated) => {
					if (gcalSource.google) {
						Object.assign(gcalSource.google, updated);
						await this.plugin.saveSettings();
					}
				},
			});
		}

		// ── CalendarStore ──────────────────────────────────────────────────────
		if (gcalAdapter) {
			this.calendarStore = new CalendarStore(gcalAdapter);
		}

		// ── SyncStore ──────────────────────────────────────────────────────────
		this.syncStore = new SyncStore(
			async (onProgress: (stage: SyncStage, pct: number) => void) => {
				const gcalSrc = this.plugin.settings.sources.find(s => s.sourceType === 'gcal_api' && s.enabled);
				const selectedCalendarIds = gcalSrc?.google?.selectedCalendarIds;
				await runSync(
					this.app,
					this.plugin.settings,
					undefined,
					undefined,
					onProgress,
					undefined,
					selectedCalendarIds,
				);
			},
			this.plugin.settings.lastSyncTime,
		);

		// ── FilterStore ────────────────────────────────────────────────────────
		this.filterStore = new FilterStore(
			this.plugin.settings,
			async (partial) => {
				Object.assign(this.plugin.settings, partial);
				await this.plugin.saveSettings();
			},
		);

		// ── Scroll container ───────────────────────────────────────────────────
		const scroll = contentEl.createDiv();
		scroll.style.cssText = 'flex:1;overflow-y:auto;';

		// ── Status Header ──────────────────────────────────────────────────────
		const gcalSettings = gcalSource?.google ?? null;
		const gcalCalendars: RichCalendarItem[] = this.calendarStore?.getCalendars() ?? [];

		this.statusHeader = new StatusHeader(scroll, {
			app: this.app,
			gcalSettings,
			calendars: gcalCalendars,
			syncStore: this.syncStore,
			onOpenSettings: () => this.plugin.openSettings(),
			onReconnect: () => {
				// Reconnect: open settings for user to re-authenticate
				this.plugin.openSettings();
			},
			onSelectCalendars: () => {
				this.calendarsSection?.expand();
				this.calendarsSection?.scrollIntoView();
			},
		});

		// ── Sync Progress ──────────────────────────────────────────────────────
		this.syncProgress = new SyncProgress(scroll, this.syncStore);

		// ── Calendars Section ──────────────────────────────────────────────────
		if (this.calendarStore && gcalSource?.google) {
			this.calendarsSection = new CalendarsSection(scroll, {
				calendarStore: this.calendarStore,
				gcalSettings: gcalSource.google,
				onSelectionChange: async (ids) => {
					if (gcalSource.google) {
						gcalSource.google.selectedCalendarIds = ids;
						await this.plugin.saveSettings();
					}
					// Update status header
					this.statusHeader?.updateGcalSettings(gcalSource.google ?? null);
				},
			});

			// Wire calendar store → status header
			this.calendarStore.subscribe((cals) => {
				this.statusHeader?.updateCalendars(cals);
			});

			// Kick off initial calendar load and expand section so user sees what loaded.
			this.calendarStore.refresh().then(() => {
				// Always expand so user can see and manually select calendars
				this.calendarsSection?.expand();
			}).catch(() => {
				// silently ignore — user may not be authenticated yet
			});
		}
		// ── Subscriptions Section ────────────────────────────────────────
		if (this.calendarStore) {
			this.subscriptionsSection = new SubscriptionsSection(scroll, {
				calendarStore: this.calendarStore,
				callbacks: {
					getProfiles: () => this.plugin.getSubscriptions().profiles,
					enableSeries: (key, name) => this.plugin.enableSeries(key, name),
					disableSeries: (key) => this.plugin.disableSeries(key),
					upsertProfile: (profile) => this.plugin.upsertProfile(profile),
				},
			});
			// Subscribe to new candidates from main plugin sync
			this.unsubNewCandidates = this.plugin.subscribeNewCandidates((items) => {
				this.subscriptionsSection?.updateCandidates(items);
			});
		}

		// ── Filters Section ──────────────────────────────────────────────────
		this.filtersSection = new FiltersSection(scroll, this.filterStore);

		// ── Preview Section ────────────────────────────────────────────────────
		this.previewSection = new PreviewSection(scroll, {
			filterStore: this.filterStore,
			fetchEvents: async () => {
				const gcalSrc = this.plugin.settings.sources.find(s => s.sourceType === 'gcal_api' && s.enabled);
				const selectedCalendarIds = gcalSrc?.google?.selectedCalendarIds;
				const result = await runSync(
					this.app,
					this.plugin.settings,
					undefined,
					undefined,
					undefined,
					undefined,
					selectedCalendarIds,
				);
				return result.normalizedEvents ?? [];
			},
		});

		// ── Heatmap Section ────────────────────────────────────────────────────
		this.heatmapSection = new HeatmapSection(scroll, this.app);
	}

	async onClose(): Promise<void> {
		this.unsubNewCandidates?.();
		this.statusHeader?.destroy();
		this.syncProgress?.destroy();
		this.calendarsSection?.destroy();
		this.subscriptionsSection?.destroy();
		this.filtersSection?.destroy();
		this.previewSection?.destroy();
		this.heatmapSection?.destroy();

		this.unsubNewCandidates = null;
		this.statusHeader = null;
		this.syncProgress = null;
		this.calendarsSection = null;
		this.subscriptionsSection = null;
		this.filtersSection = null;
		this.previewSection = null;
		this.heatmapSection = null;
	}
}
