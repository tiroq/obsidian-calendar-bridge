/**
 * Calendar Bridge — Obsidian plugin entry point.
 *
 * Features:
 *   • 5 command-palette commands
 *   • Status bar: last sync time / error indicator
 *   • Auto-sync interval timer
 *   • Startup sync
 *   • Inline "Meeting in X minutes" / "Cancelled" hints when opening meeting notes
 *   • Ribbon icon
 *   • Series subscriptions modal
 *   • Sync preview modal
 */

import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, PluginSettings, SubscriptionsState } from './types';
import { CalendarBridgeSettingsTab } from './settings';
import { runSync, SyncResult } from './sync-manager';
import { SeriesModal, SeriesModalPlugin } from './modals/series-modal';
import { PreviewModal, PreviewModalPlugin, SyncPlan, SyncPlanItem } from './modals/preview-modal';
import {
	StateManager,
	PersistedState,
	loadPersistedState,
} from './state/state-manager';
import {
	CalendarPanelView,
	VIEW_TYPE_CALENDAR_PANEL,
	CalendarBridgePanelPlugin,
} from './views/panel/CalendarPanelView';
// ─── Plugin ────────────────────────────────────────────────────────────────────

export default class CalendarBridgePlugin
	extends Plugin
	implements SeriesModalPlugin, PreviewModalPlugin, CalendarBridgePanelPlugin
{
	settings!: PluginSettings;

	/** StateManager wraps subscriptions + sync cache persistence. */
	private stateManager!: StateManager;

	/** Series candidates discovered during the last sync. */
	seriesCandidates: Map<string, { seriesName: string; count: number; nearestStart: Date }> =
		new Map();

	/** Status bar element (bottom right). */
	private statusBarItem!: HTMLElement;

	/** Listeners notified when new series/events are discovered after a sync. */
	private newCandidatesListeners: Set<(items: import('./types').NormalizedEvent[]) => void> = new Set();


	/** Handle returned by setInterval for auto-sync; 0 = not running. */
	private autoSyncHandle = 0;

	/** The most recently computed sync plan (used by applyPlan). */
	private latestPlan: SyncPlan | null = null;

	// ── Life-cycle ──────────────────────────────────────────────────────────────

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.loadState();

		// ── Status bar ────────────────────────────────────────────────────────
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();

		// ── Register panel view ─────────────────────────────────────────────
		this.registerView(
			VIEW_TYPE_CALENDAR_PANEL,
			(leaf) => new CalendarPanelView(leaf, this),
		);

		// ── Ribbon icon ──────────────────────────────────────────────────────
		this.addRibbonIcon('calendar', 'Calendar Bridge', () => {
			this.activatePanelView();
		});

		// ── Commands ──────────────────────────────────────────────────────────
		this.registerCommands();

		// ── Settings tab ──────────────────────────────────────────────────────
		this.addSettingTab(new CalendarBridgeSettingsTab(this.app, this));

		// ── Startup sync ──────────────────────────────────────────────────────
		if (this.settings.syncOnStartup) {
			this.app.workspace.onLayoutReady(() => {
				this.triggerSync();
			});
		}

		// ── Auto-sync ─────────────────────────────────────────────────────────
		this.scheduleAutoSync();

		// ── Inline hints ──────────────────────────────────────────────────────
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file) this.showInlineHints(file);
			}),
		);
	}

	async onunload(): Promise<void> {
		if (this.autoSyncHandle) {
			window.clearInterval(this.autoSyncHandle);
			this.autoSyncHandle = 0;
		}
	}

	// ── Settings persistence ────────────────────────────────────────────────────

	async loadSettings(): Promise<void> {
		const raw = await this.loadData();
		// Merge persisted settings over defaults; keep separate from state
		const persisted = (raw?.settings ?? raw) as Partial<PluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, persisted ?? {});
	}

	async saveSettings(): Promise<void> {
		const raw = (await this.loadData()) ?? {};
		await this.saveData({ ...raw, settings: this.settings });
	}

	// ── State (subscriptions + cache) ──────────────────────────────────────────

	private async loadState(): Promise<void> {
		const raw = await this.loadData();
		const state: PersistedState = loadPersistedState(raw?.state ?? {});
		this.stateManager = new StateManager(state, async (s) => {
			const current = (await this.loadData()) ?? {};
			await this.saveData({ ...current, state: s });
		});
	}

	getSubscriptions(): SubscriptionsState {
		return this.stateManager.getSubscriptions();
	}

	async enableSeries(key: string, name: string): Promise<void> {
		await this.stateManager.enableSeries(key, name);
	}

	async disableSeries(key: string): Promise<void> {
		await this.stateManager.disableSeries(key);
	}

	async upsertProfile(profile: import('./types').SeriesProfile): Promise<void> {
		await this.stateManager.upsertProfile(profile);
	}

	async toggleSeriesHidden(key: string, name: string): Promise<void> {
		await this.stateManager.toggleSeriesHidden(key, name);
	}

	/** Compatibility wrapper for SeriesModal — bulk-replace all profiles. */
	async saveSubscriptions(state: import('./types').SubscriptionsState): Promise<void> {
		for (const profile of Object.values(state.profiles)) {
			await this.stateManager.upsertProfile(profile);
		}
	}

	// ── Commands ────────────────────────────────────────────────────────────────

	private registerCommands(): void {
		// 1. Sync next N days
		this.addCommand({
			id: 'sync-next-n-days',
			name: 'Sync next N days',
			callback: () => {
				this.triggerSync();
			},
		});

		// 2. Preview sync plan
		this.addCommand({
			id: 'preview-sync-plan',
			name: 'Preview sync plan',
			callback: async () => {
				await this.triggerPreview();
			},
		});

		// 3. Select/Manage series subscriptions
		this.addCommand({
			id: 'manage-series-subscriptions',
			name: 'Select/Manage series subscriptions',
			callback: () => {
				new SeriesModal(this.app, this).open();
			},
		});

		// 4. Open series page for current note
		this.addCommand({
			id: 'open-series-page',
			name: 'Open series page (for current note)',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				this.openSeriesPageForNote(file);
			},
		});

		// 5. Create note for selected event (manual mode — opens event picker)
		this.addCommand({
			id: 'create-note-for-event',
			name: 'Create note for selected event',
			callback: () => {
				this.triggerCreateNoteForEvent();
			},
		});
	}


	// ── Panel view ───────────────────────────────────────────────────────────

		/** Open or focus the Calendar Bridge control panel in the right sidebar. */
	private async activatePanelView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR_PANEL);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_CALENDAR_PANEL, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	/** Open the plugin settings tab (required by CalendarBridgePanelPlugin). */
	openSettings(): void {
		// @ts-ignore — Obsidian's setting tab opening is not typed in the public API
		(this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting?.openTabById(this.manifest.id);
	}

	// ── Sync ─────────────────────────────────────────────────────────────────────

	/**
	 * Run a full idempotent sync and show a Notice with the result.
	 * Also populates seriesCandidates for use by the Series Modal.
	 */
	/**
	 * Build the per-series enablement callback used by all runSync() calls.
	 * Non-recurring events always pass through; unknown recurring series become
	 * new candidates; known recurring series respect their enabled flag.
	 */
	private buildIsSeriesEnabled(): (key: string, isRecurring?: boolean) => boolean | undefined {
		return (key: string, isRecurring?: boolean): boolean | undefined => {
			if (!isRecurring) {
				console.log(`[CalendarBridge] SERIES_GATE — key=${key} recurring=false → true (bypass)`);
				return true;
			}
			const profile = this.stateManager.getProfile(key);
			if (!profile) {
				console.log(`[CalendarBridge] SERIES_GATE — key=${key} recurring=true profile=NOT_FOUND → undefined (new candidate)`);
				return undefined;
			}
			console.log(`[CalendarBridge] SERIES_GATE — key=${key} recurring=true profile.enabled=${profile.enabled} → ${profile.enabled}`);
			return profile.enabled;
		};
	}

	async triggerSync(): Promise<void> {
		const enabledSources = this.settings.sources.filter(s => s.enabled);
		if (enabledSources.length === 0) {
			new Notice('Calendar Bridge: No calendar sources configured.');
			return;
		}

		this.updateStatusBar('Syncing…');
		new Notice('Calendar Bridge: Syncing…');

	let result: SyncResult;
	try {
		// Resolve selectedCalendarIds from the first gcal_api source
	const gcalSource = this.settings.sources.find(s => s.sourceType === 'gcal_api' && s.enabled);
		const selectedCalendarIds = gcalSource?.google?.selectedCalendarIds;
		console.log(`[CalendarBridge] TRIGGER_SYNC — sources=${enabledSources.length} gcal=${!!gcalSource} selectedCalendarIds=${selectedCalendarIds ? JSON.stringify(selectedCalendarIds) : 'none'}`);
		// Pass stateManager.isEnabled so sync respects per-series opt-in.
		// Returns undefined for unknown keys so they land in newCandidates.
		const isSeriesEnabled = this.buildIsSeriesEnabled();
		result = await runSync(
			this.app,
			this.settings,
			undefined,
			undefined,
			undefined,
			isSeriesEnabled,
			selectedCalendarIds,
		);
	} catch (err) {
		const msg = (err as Error).message;
		this.updateStatusBar(`Sync error: ${msg}`, true);
		new Notice(`Calendar Bridge: Sync failed — ${msg}`);
		return;
	}

	// Persist last-sync timestamp
	this.settings.lastSyncTime = new Date().toLocaleString();
	await this.saveSettings();

	// Populate series candidates + notify panel about new discoveries
	this.updateSeriesCandidates(result);
	if ((result.newCandidates ?? []).length > 0) {
		this.onNewCandidates(result.newCandidates!);
	}

	const { created, updated, skipped, errors, eventsFetched, eventsEligible, zeroReason } = result;
	const parts: string[] = [];
	if (created > 0) parts.push(`${created} created`);
	if (updated > 0) parts.push(`${updated} updated`);
	if (skipped > 0) parts.push(`${skipped} unchanged`);

	let summary: string;
	if (parts.length > 0) {
		summary = parts.join(', ') + ` (fetched ${eventsFetched}, eligible ${eventsEligible})`;
	} else if (zeroReason) {
		summary = zeroReason;
	} else {
		summary = 'Nothing to do';
	}
	const errStr = errors.length > 0 ? ` ⚠ ${errors.length} error(s)` : '';

	this.updateStatusBar(`Synced ${new Date().toLocaleTimeString()}`);
	new Notice(`Calendar Bridge: ${summary}${errStr}`);

	if (errors.length > 0) {
		console.error('[Calendar Bridge] Sync errors:', errors);
	}
	}

	/**
	 * Compute a dry-run sync plan and show it in the PreviewModal.
	 */
	private async triggerPreview(): Promise<void> {
		const enabledSources = this.settings.sources.filter(s => s.enabled);
		if (enabledSources.length === 0) {
			new Notice('Calendar Bridge: No calendar sources configured.');
			return;
		}

		new Notice('Calendar Bridge: Computing preview…');

		let plan: SyncPlan;
		try {
			plan = await this.computeSyncPlan();
		} catch (err) {
			new Notice(`Calendar Bridge: Preview failed — ${(err as Error).message}`);
			return;
		}

		this.latestPlan = plan;
		new PreviewModal(this.app, this, plan).open();
	}

	/**
	 * Compute the sync plan (dry run) by re-using the sync engine in preview mode.
	 * Falls back to a simple "run sync and map results to plan items" approach.
	 */
private async computeSyncPlan(): Promise<SyncPlan> {
		// Run a real sync (which is idempotent) and capture the result as plan items.
		// Pass selectedCalendarIds so gcal events are fetched and included in the plan.
		const gcalSource = this.settings.sources.find(s => s.sourceType === 'gcal_api' && s.enabled);
		const selectedCalendarIds = gcalSource?.google?.selectedCalendarIds;
		const result = await runSync(this.app, this.settings, undefined, undefined, undefined, this.buildIsSeriesEnabled(), selectedCalendarIds);

		const items: SyncPlanItem[] = [];

		for (const event of (result.normalizedEvents ?? [])) {
			const { getNotePath } = await import('./note-generator');
			const path = getNotePath(event, this.settings);
			const exists = this.app.vault.getAbstractFileByPath(path) !== null;
			items.push({
				action: exists ? 'update' : 'create',
				path,
				reason: exists ? 'AUTOGEN refresh' : 'new event',
			});
		}

		return { items, errors: result.errors };
	}

	/**
	 * Execute a pre-computed sync plan (called by PreviewModal).
	 */
	async applyPlan(_plan: SyncPlan): Promise<{ created: number; updated: number; errors: string[] }> {
		// Apply by running the real sync (idempotent — will only write what changed)
		const gcalSource = this.settings.sources.find(s => s.sourceType === 'gcal_api' && s.enabled);
		const selectedCalendarIds = gcalSource?.google?.selectedCalendarIds;
		const result = await runSync(this.app, this.settings, undefined, undefined, undefined, this.buildIsSeriesEnabled(), selectedCalendarIds);
		this.settings.lastSyncTime = new Date().toLocaleString();
		await this.saveSettings();
		this.updateStatusBar(`Synced ${new Date().toLocaleTimeString()}`);
		return {
			created: result.created,
			updated: result.updated,
			errors: result.errors,
		};
	}

	// ── Series page navigation ──────────────────────────────────────────────────

	/**
	 * Opens the series index page linked from the current meeting note.
	 * Looks for a `series_key` in the file's frontmatter.
	 */
	private async openSeriesPageForNote(file: TFile): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(file);
		const seriesKey = cache?.frontmatter?.['series_key'] as string | undefined;

		if (!seriesKey) {
			new Notice('Calendar Bridge: No series_key found in the current note\'s frontmatter.');
			return;
		}

		// Find the series page file
		const seriesRoot = this.settings.seriesRoot;
		const slug = seriesKey
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
		const seriesPath = `${seriesRoot}/${slug}.md`;

		const seriesFile = this.app.vault.getAbstractFileByPath(seriesPath);
		if (!seriesFile || !(seriesFile instanceof TFile)) {
			new Notice(`Calendar Bridge: Series page not found at "${seriesPath}". Run a sync first.`);
			return;
		}

		const leaf = this.app.workspace.getLeaf(false) as WorkspaceLeaf;
		await leaf.openFile(seriesFile);
	}

	// ── Manual event picker ─────────────────────────────────────────────────────

	/**
	 * "Create note for selected event" — shows a list of upcoming events
	 * and creates a note for the one the user picks.
	 * Uses a simple Notice-based picker for now (a full modal would be added in v1.1).
	 */
	private triggerCreateNoteForEvent(): void {
		// For v1.0, trigger a regular sync which is idempotent
		new Notice(
			'Calendar Bridge: Syncing to create notes for all upcoming events. ' +
			'A dedicated event picker will be available in a future version.',
		);
		this.triggerSync();
	}

	// ── Series candidates ───────────────────────────────────────────────────────

	/**
	 * Rebuild the seriesCandidates Map from the last sync result.
	 * Used by the SeriesModal (Section A).
	 */
	private updateSeriesCandidates(result: SyncResult): void {
		this.seriesCandidates.clear();
		for (const event of (result.normalizedEvents ?? [])) {
			if (!event.isRecurring || !event.seriesKey) continue;
			const key = event.seriesKey;
			const existing = this.seriesCandidates.get(key);
			const start = event.startDate;
			if (!existing) {
				this.seriesCandidates.set(key, {
					seriesName: event.title,
					count: 1,
					nearestStart: start,
				});
			} else {
				existing.count++;
				if (start < existing.nearestStart) existing.nearestStart = start;
			}
		}
	}

	/** Dispatch new candidates to all panel listeners. */
	private onNewCandidates(items: import('./types').NormalizedEvent[]): void {
		for (const fn of this.newCandidatesListeners) fn(items);
	}

	/**
	 * Subscribe to new-candidate events from sync.
	 * Returns an unsubscribe function.
	 */
	subscribeNewCandidates(fn: (items: import('./types').NormalizedEvent[]) => void): () => void {
		this.newCandidatesListeners.add(fn);
		return () => this.newCandidatesListeners.delete(fn);
	}

	// ── Auto-sync ─────────────────────────────────────────────────────────────────

	// ── Auto-sync ───────────────────────────────────────────────────────────────

	private scheduleAutoSync(): void {
		if (this.autoSyncHandle) {
			window.clearInterval(this.autoSyncHandle);
			this.autoSyncHandle = 0;
		}
		const intervalMin = this.settings.autoSyncIntervalMinutes;
		if (intervalMin > 0) {
			this.autoSyncHandle = window.setInterval(
				() => { this.triggerSync(); },
				intervalMin * 60 * 1000,
			);
		}
	}

	// ── Status bar ──────────────────────────────────────────────────────────────

	private updateStatusBar(msg?: string, isError = false): void {
		if (!this.statusBarItem) return;
		const text = msg ?? (this.settings.lastSyncTime
			? `CB: ${this.settings.lastSyncTime}`
			: 'CB: never synced');
		this.statusBarItem.setText(text);
		this.statusBarItem.toggleClass('mod-error', isError);
	}

	// ── Inline hints ────────────────────────────────────────────────────────────

	/**
	 * When a meeting note is opened:
	 *   - If status=cancelled → notice "Cancelled"
	 *   - If start is within the next 2 hours → notice "Meeting in X minutes"
	 */
	private showInlineHints(file: TFile): void {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) return;

		const fm = cache.frontmatter;
		if (fm['type'] !== 'meeting') return;

		// Cancelled check
		if (fm['status'] === 'cancelled') {
			new Notice(`📅 This meeting has been cancelled.`, 6000);
			return;
		}

		// Upcoming check
		const startStr = fm['date_start'] as string | undefined;
		if (!startStr) return;

		try {
			const start = new Date(startStr);
			const now = new Date();
			const diffMs = start.getTime() - now.getTime();
			const diffMin = Math.round(diffMs / 60000);

			if (diffMin > 0 && diffMin <= 120) {
				const label = diffMin < 2 ? 'right now' : `in ${diffMin} minutes`;
				new Notice(`📅 Meeting ${label}`, 8000);
			}
		} catch {
			// ignore parse errors
		}
	}
}
