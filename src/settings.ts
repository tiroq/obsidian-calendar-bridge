/**
 * Obsidian Settings Tab for Calendar Bridge.
 */

import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from 'obsidian';
import { CalendarSource, PluginSettings } from './types';

// Re-export so main.ts can import from a single settings module
export type { PluginSettings };
export { DEFAULT_SETTINGS } from './types';

// ─── Settings Tab ─────────────────────────────────────────────────────────────

/** Interface for the bits of CalendarBridgePlugin that the settings tab needs. */
interface CalendarBridgePluginLike extends Plugin {
	settings: PluginSettings;
	saveSettings(): Promise<void>;
	triggerSync(): Promise<void>;
}

export class CalendarBridgeSettingsTab extends PluginSettingTab {
	private plugin: CalendarBridgePluginLike;

	constructor(app: App, plugin: CalendarBridgePluginLike) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Calendar Bridge' });

		// ── Calendar Sources ──────────────────────────────────────────────
		new Setting(containerEl).setName('Calendar Sources').setHeading();

		const sources = this.plugin.settings.calendarSources;
		sources.forEach((source, index) => {
			this.renderSource(containerEl, source, index);
		});

		new Setting(containerEl).addButton(btn =>
			btn
				.setButtonText('＋ Add calendar source')
				.setCta()
				.onClick(async () => {
					this.plugin.settings.calendarSources.push({
						id: `source-${Date.now()}`,
						name: 'My Calendar',
						url: '',
						enabled: true,
					});
					await this.plugin.saveSettings();
					this.display();
				}),
		);

		// ── Sync Settings ─────────────────────────────────────────────────
		new Setting(containerEl).setName('Sync Settings').setHeading();

		new Setting(containerEl)
			.setName('Notes folder')
			.setDesc('Vault folder where individual meeting notes are created.')
			.addText(t =>
				t
					.setPlaceholder('Meetings')
					.setValue(this.plugin.settings.notesFolder)
					.onChange(async v => {
						this.plugin.settings.notesFolder = v.trim() || 'Meetings';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Series folder')
			.setDesc('Vault folder where recurring-series index pages are created.')
			.addText(t =>
				t
					.setPlaceholder('Meetings/Series')
					.setValue(this.plugin.settings.seriesFolder)
					.onChange(async v => {
						this.plugin.settings.seriesFolder = v.trim() || 'Meetings/Series';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Template note path')
			.setDesc(
				'Vault path to a custom note template. ' +
				'Leave blank to use the built-in template.',
			)
			.addText(t =>
				t
					.setPlaceholder('Templates/Meeting.md')
					.setValue(this.plugin.settings.templatePath)
					.onChange(async v => {
						this.plugin.settings.templatePath = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Sync horizon (days)')
			.setDesc('How many days ahead of today to sync events.')
			.addSlider(s =>
				s
					.setLimits(1, 90, 1)
					.setValue(this.plugin.settings.syncHorizonDays)
					.setDynamicTooltip()
					.onChange(async v => {
						this.plugin.settings.syncHorizonDays = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Sync on startup')
			.setDesc('Automatically run a sync when Obsidian opens.')
			.addToggle(t =>
				t
					.setValue(this.plugin.settings.syncOnStartup)
					.onChange(async v => {
						this.plugin.settings.syncOnStartup = v;
						await this.plugin.saveSettings();
					}),
			);

		// ── Format Settings ───────────────────────────────────────────────
		new Setting(containerEl).setName('Format Settings').setHeading();

		new Setting(containerEl)
			.setName('Date format')
			.setDesc('Tokens: YYYY (year), MM (month), DD (day). Used in note filenames and content.')
			.addText(t =>
				t
					.setPlaceholder('YYYY-MM-DD')
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async v => {
						this.plugin.settings.dateFormat = v.trim() || 'YYYY-MM-DD';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Time format')
			.setDesc('Tokens: HH (24-hour), mm (minutes). Used in note content.')
			.addText(t =>
				t
					.setPlaceholder('HH:mm')
					.setValue(this.plugin.settings.timeFormat)
					.onChange(async v => {
						this.plugin.settings.timeFormat = v.trim() || 'HH:mm';
						await this.plugin.saveSettings();
					}),
			);

		// ── Actions ───────────────────────────────────────────────────────
		new Setting(containerEl).setName('Actions').setHeading();

		new Setting(containerEl)
			.setName('Sync now')
			.setDesc('Manually trigger a full calendar sync.')
			.addButton(btn =>
				btn
					.setButtonText('Sync now')
					.setCta()
					.onClick(async () => {
						btn.setDisabled(true).setButtonText('Syncing…');
						try {
							await this.plugin.triggerSync();
						} finally {
							btn.setDisabled(false).setButtonText('Sync now');
						}
					}),
			);

		if (this.plugin.settings.lastSyncTime) {
			new Setting(containerEl)
				.setName('Last synced')
				.setDesc(this.plugin.settings.lastSyncTime);
		}
	}

	// ─── Private helpers ──────────────────────────────────────────────────────

	private renderSource(
		containerEl: HTMLElement,
		source: CalendarSource,
		index: number,
	): void {
		const wrapper = containerEl.createDiv({ cls: 'calendar-bridge-source' });

		new Setting(wrapper)
			.setName(`Source ${index + 1}`)
			.addToggle(t =>
				t.setValue(source.enabled).onChange(async v => {
					source.enabled = v;
					await this.plugin.saveSettings();
				}),
			)
			.addExtraButton(btn =>
				btn
					.setIcon('trash')
					.setTooltip('Remove this source')
					.onClick(async () => {
						this.plugin.settings.calendarSources.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		new Setting(wrapper)
			.setName('Name')
			.addText(t =>
				t
					.setPlaceholder('Work Calendar')
					.setValue(source.name)
					.onChange(async v => {
						source.name = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(wrapper)
			.setName('ICS URL')
			.setDesc(
				'Google Calendar ICS export URL or any public .ics feed URL.',
			)
			.addText(t =>
				t
					.setPlaceholder('https://calendar.google.com/calendar/ical/…/basic.ics')
					.setValue(source.url)
					.onChange(async v => {
						source.url = v.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
