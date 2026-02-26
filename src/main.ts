/**
 * Calendar Bridge — Obsidian plugin entry point.
 *
 * Connects Google Calendar or ICS feeds and auto-generates structured meeting
 * drafts.  Supports:
 *   • Series subscriptions (recurring-event index pages)
 *   • Idempotent sync for upcoming events
 *   • Template-based notes with protected AUTOGEN blocks
 *   • Cross-links between individual meeting notes and their series pages
 */

import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, PluginSettings } from './types';
import { CalendarBridgeSettingsTab } from './settings';
import { runSync, SyncResult } from './sync-manager';

export default class CalendarBridgePlugin extends Plugin {
	settings!: PluginSettings;

	// ── Life-cycle ────────────────────────────────────────────────────────────

	async onload(): Promise<void> {
		await this.loadSettings();

		// Ribbon icon
		this.addRibbonIcon('calendar-days', 'Calendar Bridge: Sync now', () => {
			this.triggerSync();
		});

		// Command palette entry
		this.addCommand({
			id: 'calendar-bridge-sync',
			name: 'Sync calendar events',
			callback: () => {
				this.triggerSync();
			},
		});

		// Settings tab
		this.addSettingTab(new CalendarBridgeSettingsTab(this.app, this));

		// Startup sync (deferred slightly so the vault is fully loaded)
		if (this.settings.syncOnStartup) {
			this.app.workspace.onLayoutReady(() => {
				this.triggerSync();
			});
		}
	}

	async onunload(): Promise<void> {
		// Nothing to clean up
	}

	// ── Settings persistence ──────────────────────────────────────────────────

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ── Sync ──────────────────────────────────────────────────────────────────

	/**
	 * Run a full idempotent sync and show a Notice with the result.
	 */
	async triggerSync(): Promise<void> {
		const enabledSources = this.settings.calendarSources.filter(s => s.enabled);
		if (enabledSources.length === 0) {
			new Notice('Calendar Bridge: No calendar sources configured.');
			return;
		}

		new Notice('Calendar Bridge: Syncing…');

		let result: SyncResult;
		try {
			result = await runSync(this.app, this.settings);
		} catch (err) {
			new Notice(`Calendar Bridge: Sync failed — ${(err as Error).message}`);
			return;
		}

		// Persist the last-sync timestamp
		this.settings.lastSyncTime = new Date().toLocaleString();
		await this.saveSettings();

		const { created, updated, skipped, errors } = result;
		const parts: string[] = [];
		if (created > 0) parts.push(`${created} created`);
		if (updated > 0) parts.push(`${updated} updated`);
		if (skipped > 0) parts.push(`${skipped} unchanged`);

		const summary = parts.length > 0 ? parts.join(', ') : 'Nothing to do';
		const errStr = errors.length > 0 ? `\n⚠ ${errors.length} error(s)` : '';

		new Notice(`Calendar Bridge: ${summary}${errStr}`);

		if (errors.length > 0) {
			console.error('[Calendar Bridge] Sync errors:', errors);
		}
	}
}
