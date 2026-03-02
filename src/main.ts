/**
 * Calendar Bridge — Obsidian plugin entry point.
 *
 * Features:
 *   • 7 command-palette commands
 *   • Status bar: last sync time / error indicator
 *   • Auto-sync interval timer
 *   • Startup sync
 *   • Inline "Meeting in X minutes" / "Cancelled" hints when opening meeting notes
 *   • Ribbon icon
 *   • Series subscriptions modal
 *   • Sync preview modal
 */

import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, PluginSettings, SubscriptionsState, SyncStage } from './types';
import { CalendarBridgeSettingsTab } from './settings';
import { runSync, SyncResult } from './sync-manager';
import { sanitizeFilename } from './note-generator';
import { buildSyncPlan } from './services/PlanningService';
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
import { DiagnosticsService } from './services/DiagnosticsService';
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


	private diagnosticsService = new DiagnosticsService();
	/** DiagnosticsService stores last N sync reports in memory. */
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

	/**
	 * Run sync with progress callback — used by the panel's Sync Now button.
	 * Delegates to triggerSync internals so series gating is applied.
	 */
	async triggerSyncWithProgress(onProgress: (stage: SyncStage, pct: number) => void): Promise<void> {
		const gcalSource = this.settings.sources.find(s => s.sourceType === 'gcal_api' && s.enabled);
		const selectedCalendarIds = gcalSource?.google?.selectedCalendarIds;
		await runSync(this.app, this.settings, undefined, undefined, onProgress, this.buildIsSeriesEnabled(), selectedCalendarIds, this.buildGetSeriesProfile());
	}

	/**
	 * Fetch normalized events with series gating — used by panel Preview/Heatmap.
	 */
	async fetchNormalizedEvents(): Promise<import('./types').NormalizedEvent[]> {
		const gcalSource = this.settings.sources.find(s => s.sourceType === 'gcal_api' && s.enabled);
		const selectedCalendarIds = gcalSource?.google?.selectedCalendarIds;
		const result = await runSync(this.app, this.settings, undefined, undefined, undefined, this.buildIsSeriesEnabled(), selectedCalendarIds, this.buildGetSeriesProfile());
		return result.normalizedEvents ?? [];
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
		// 6. Promote selected tasks to series
		this.addCommand({
			id: 'promote-tasks-to-series',
			name: 'Promote selected tasks to series note',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				this.promoteTasksToSeries(file);
			},
		});

		// 7. Migrate legacy series actions into series note
		this.addCommand({
			id: 'migrate-series-actions',
			name: 'Migrate legacy series actions into series note',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				this.migrateLegacySeriesActions(file);
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
		const s = (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting;
		s?.open();
		s?.openTabById(this.manifest.id);
	}

	// ── Series task promotion ──────────────────────────────────────────────────

	/**
	 * Append `^series` to every incomplete task in the current editor selection.
	 * If there is no active selection, appends to all incomplete tasks in the file.
	 */
	private async promoteTasksToSeries(file: TFile): Promise<void> {
		const marker = this.settings.seriesActionMarker ?? '^series';
		const editor = this.app.workspace.activeEditor?.editor;
		const content = await this.app.vault.read(file);
		const lines = content.split('\n');

		let selectionStart: number | null = null;
		let selectionEnd: number | null = null;
		if (editor) {
			const sel = editor.listSelections?.();
			if (sel && sel.length > 0) {
				selectionStart = Math.min(sel[0].anchor.line, sel[0].head.line);
				selectionEnd   = Math.max(sel[0].anchor.line, sel[0].head.line);
			}
		}

		let promoted = 0;
		const updated = lines.map((line, idx) => {
			if (selectionStart !== null && selectionEnd !== null) {
				if (idx < selectionStart || idx > selectionEnd) return line;
			}
			// Only incomplete task lines: - [ ] ...
			if (!/^\s*-\s+\[\s\]/.test(line)) return line;
			// Already has the marker
			if (line.includes(marker)) return line;
			promoted++;
			return line.trimEnd() + ' ' + marker;
		});

		if (promoted === 0) {
			new Notice('No promotable tasks found (incomplete tasks without ' + marker + ').');
			return;
		}
		await this.app.vault.modify(file, updated.join('\n'));
		new Notice(`Promoted ${promoted} task(s) with ${marker}. Run sync to aggregate into the series note.`);
	}

	/**
	 * Inspect the current meeting note for legacy CB_ACTIONS content that contains
	 * incomplete tasks WITHOUT the series marker. Shows a guidance Notice so the
	 * user knows which tasks to promote before the next sync.
	 */
	private async migrateLegacySeriesActions(file: TFile): Promise<void> {
		const marker = this.settings.seriesActionMarker ?? '^series';
		const content = await this.app.vault.read(file);

		// Extract CB_ACTIONS slot content
		const slotMatch = content.match(
			/<!--\s*CB:BEGIN\s+CB_ACTIONS\s*-->([\s\S]*?)<!--\s*CB:END\s+CB_ACTIONS\s*-->/,
		);
		if (!slotMatch) {
			new Notice('No CB_ACTIONS block found in this note.');
			return;
		}

		const slotContent = slotMatch[1];
		const legacyTasks = slotContent
			.split('\n')
			.filter(l => /^\s*-\s+\[\s\]/.test(l) && !l.includes(marker));

		if (legacyTasks.length === 0) {
			new Notice('No legacy actions found. All tasks already have ' + marker + ' or the block is empty.');
			return;
		}

		new Notice(
			`Found ${legacyTasks.length} legacy action(s) without "${marker}". ` +
			'Use "Promote selected tasks to series note" to mark them for series aggregation, then run sync.',
			8000,
		);
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

	/** Build the per-series profile getter callback used by all runSync() calls. */
	private buildGetSeriesProfile(): (key: string) => import('./types').SeriesProfile | undefined {
		return (key: string) => this.stateManager.getProfile(key);
	}

	/** Return the latest sync report (for the Debug panel). */
	getLastSyncReport(): import('./types').SyncReport | null {
		return this.diagnosticsService.getLatest();
	}

	async triggerSync(): Promise<void> {
		const enabledSources = this.settings.sources.filter(s => s.enabled);
		if (enabledSources.length === 0) {
			new Notice('Calendar Bridge: No calendar sources configured.');
			return;
		}

		this.updateStatusBar('Syncing…');
		new Notice('Calendar Bridge: Syncing…');

	let syncStartedAt: Date;
	let result: SyncResult;
	syncStartedAt = new Date();
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
			this.buildGetSeriesProfile(),
		);
	} catch (err) {
		const msg = (err as Error).message;
		this.updateStatusBar(`Sync error: ${msg}`, true);
		new Notice(`Calendar Bridge: Sync failed — ${msg}`);
		return;
	}
	// Record in DiagnosticsService
	this.diagnosticsService.recordSyncResult(result, syncStartedAt);

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
		// Fetch events via sync, then delegate plan building to PlanningService.
		const gcalSource = this.settings.sources.find(s => s.sourceType === 'gcal_api' && s.enabled);
		const selectedCalendarIds = gcalSource?.google?.selectedCalendarIds;
		const result = await runSync(this.app, this.settings, undefined, undefined, undefined, this.buildIsSeriesEnabled(), selectedCalendarIds, this.buildGetSeriesProfile());

		const normalizedEvents = result.normalizedEvents ?? [];
		const items = buildSyncPlan(this.app, {
			events: normalizedEvents,
			settings: this.settings,
		});
		return { items, errors: result.errors };
	}

	/**
	 * Execute a pre-computed sync plan (called by PreviewModal).
	 */
	async applyPlan(_plan: SyncPlan): Promise<{ created: number; updated: number; errors: string[] }> {
		// Apply by running the real sync (idempotent — will only write what changed)
		const gcalSource = this.settings.sources.find(s => s.sourceType === 'gcal_api' && s.enabled);
		const selectedCalendarIds = gcalSource?.google?.selectedCalendarIds;
		const result = await runSync(this.app, this.settings, undefined, undefined, undefined, this.buildIsSeriesEnabled(), selectedCalendarIds, this.buildGetSeriesProfile());
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
		const seriesKey  = cache?.frontmatter?.['series_key']  as string | undefined;
		const seriesName = cache?.frontmatter?.['series_name'] as string | undefined;

		if (!seriesKey && !seriesName) {
			new Notice('Calendar Bridge: No series_key found in the current note\'s frontmatter.');
			return;
		}

		const seriesRoot = this.settings.seriesRoot;

		// Primary lookup: use series_name with same sanitization used at creation time
		if (seriesName) {
			const seriesPath = `${seriesRoot}/${sanitizeFilename(seriesName)}.md`;
			const seriesFile = this.app.vault.getAbstractFileByPath(seriesPath);
			if (seriesFile instanceof TFile) {
				const leaf = this.app.workspace.getLeaf(false) as WorkspaceLeaf;
				await leaf.openFile(seriesFile);
				return;
			}
		}

		// Fallback: scan series folder for a file whose series_key frontmatter matches
		// (handles old/slugified series pages created before this fix)
		if (seriesKey) {
			const files = this.app.vault.getFiles().filter(f => f.path.startsWith(seriesRoot + '/'));
			for (const f of files) {
				const fc = this.app.metadataCache.getFileCache(f);
				if (fc?.frontmatter?.['series_key'] === seriesKey) {
					const leaf = this.app.workspace.getLeaf(false) as WorkspaceLeaf;
					await leaf.openFile(f);
					return;
				}
			}
		}

		new Notice('Calendar Bridge: Series page not found. Run a sync first.');
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
