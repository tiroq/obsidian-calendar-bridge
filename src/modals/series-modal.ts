/**
 * Series Subscriptions Modal for Calendar Bridge.
 *
 * Section A: Upcoming series candidates from the last sync
 *   - Shows series key, name, event count, nearest start time
 *   - Checkbox to enable autogen for that series
 *   - Quick "rename" action
 *
 * Section B: Currently enabled series
 *   - Edit profile (opens sub-form)
 *   - Disable button
 */

import { App, Modal, Setting } from 'obsidian';
import { PluginSettings, SeriesProfile, SubscriptionsState } from '../types';

/** Minimal interface for what this modal needs from the plugin. */
export interface SeriesModalPlugin {
	app: App;
	settings: PluginSettings;
	saveSettings(): Promise<void>;
	getSubscriptions(): SubscriptionsState;
	saveSubscriptions(state: SubscriptionsState): Promise<void>;
	/** Series candidates discovered from the most recent sync (seriesKey → display name + count). */
	seriesCandidates: Map<string, { seriesName: string; count: number; nearestStart: Date }>;
}

export class SeriesModal extends Modal {
	private plugin: SeriesModalPlugin;
	private subscriptions: SubscriptionsState;

	constructor(app: App, plugin: SeriesModalPlugin) {
		super(app);
		this.plugin = plugin;
		this.subscriptions = plugin.getSubscriptions();
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('calendar-bridge-series-modal');

		contentEl.createEl('h2', { text: 'Series Subscriptions' });

		this.renderSectionA(contentEl);
		this.renderSectionB(contentEl);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// ─── Section A: Candidates ─────────────────────────────────────────────────

	private renderSectionA(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: 'Available Series' });

		const candidates = this.plugin.seriesCandidates;

		if (candidates.size === 0) {
			containerEl.createEl('p', {
				text: 'No recurring series detected in the current sync window. Run a sync first.',
				cls: 'calendar-bridge-empty',
			});
			return;
		}

		for (const [seriesKey, info] of candidates) {
			const isEnabled = !!(this.subscriptions.profiles[seriesKey]?.enabled);

			const setting = new Setting(containerEl)
				.setName(info.seriesName)
				.setDesc(
					`${info.count} occurrence(s) · Next: ${info.nearestStart.toLocaleString()}`,
				)
				.addToggle(t =>
					t.setValue(isEnabled).onChange(async enabled => {
						if (enabled) {
							this.subscriptions.profiles[seriesKey] = {
								seriesKey,
								seriesName: info.seriesName,
								enabled: true,
							};
						} else {
							if (this.subscriptions.profiles[seriesKey]) {
								this.subscriptions.profiles[seriesKey].enabled = false;
							}
						}
						await this.plugin.saveSubscriptions(this.subscriptions);
						this.onOpen(); // re-render
					}),
				);

			// Rename quick action
			setting.addExtraButton(btn =>
				btn
					.setIcon('pencil')
					.setTooltip('Rename series')
					.onClick(() => {
						this.openRenameDialog(seriesKey, info.seriesName);
					}),
			);
		}
	}

	// ─── Section B: Enabled series ────────────────────────────────────────────

	private renderSectionB(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: 'Enabled Series' });

		const enabled = Object.values(this.subscriptions.profiles).filter(p => p.enabled);

		if (enabled.length === 0) {
			containerEl.createEl('p', {
				text: 'No series enabled yet. Enable series above to start generating notes.',
				cls: 'calendar-bridge-empty',
			});
			return;
		}

		for (const profile of enabled) {
			new Setting(containerEl)
				.setName(profile.seriesName)
				.setDesc(`Key: ${profile.seriesKey}`)
				.addButton(btn =>
					btn
						.setButtonText('Edit profile')
						.onClick(() => {
							this.openProfileEditor(profile);
						}),
				)
				.addButton(btn =>
					btn
						.setButtonText('Disable')
						.setWarning()
						.onClick(async () => {
							profile.enabled = false;
							await this.plugin.saveSubscriptions(this.subscriptions);
							this.onOpen();
						}),
				);
		}
	}

	// ─── Rename dialog ─────────────────────────────────────────────────────────

	private openRenameDialog(seriesKey: string, currentName: string): void {
		const dialog = new RenameDialog(this.app, currentName, async newName => {
			if (!this.subscriptions.profiles[seriesKey]) {
				this.subscriptions.profiles[seriesKey] = {
					seriesKey,
					seriesName: newName,
					enabled: false,
				};
			} else {
				this.subscriptions.profiles[seriesKey].seriesName = newName;
			}
			await this.plugin.saveSubscriptions(this.subscriptions);
			this.onOpen();
		});
		dialog.open();
	}

	// ─── Profile editor ────────────────────────────────────────────────────────

	private openProfileEditor(profile: SeriesProfile): void {
		const editor = new ProfileEditorModal(this.app, profile, async updated => {
			this.subscriptions.profiles[updated.seriesKey] = updated;
			await this.plugin.saveSubscriptions(this.subscriptions);
			this.onOpen();
		});
		editor.open();
	}
}

// ─── Rename Dialog ─────────────────────────────────────────────────────────────

class RenameDialog extends Modal {
	private currentName: string;
	private onSave: (name: string) => Promise<void>;

	constructor(app: App, currentName: string, onSave: (name: string) => Promise<void>) {
		super(app);
		this.currentName = currentName;
		this.onSave      = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Rename Series' });

		let value = this.currentName;

		new Setting(contentEl)
			.setName('Series name')
			.addText(t =>
				t
					.setValue(value)
					.onChange(v => { value = v; }),
			);

		new Setting(contentEl)
			.addButton(btn =>
				btn.setButtonText('Save').setCta().onClick(async () => {
					if (value.trim()) {
						await this.onSave(value.trim());
						this.close();
					}
				}),
			)
			.addButton(btn =>
				btn.setButtonText('Cancel').onClick(() => this.close()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ─── Profile Editor Modal ──────────────────────────────────────────────────────

class ProfileEditorModal extends Modal {
	private profile: SeriesProfile;
	private onSave: (profile: SeriesProfile) => Promise<void>;
	private draft: SeriesProfile;

	constructor(
		app: App,
		profile: SeriesProfile,
		onSave: (profile: SeriesProfile) => Promise<void>,
	) {
		super(app);
		this.profile = profile;
		this.onSave  = onSave;
		// deep-copy to avoid mutating until Save
		this.draft = { ...profile };
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: `Edit: ${this.profile.seriesName}` });

		new Setting(contentEl)
			.setName('Series name')
			.addText(t =>
				t.setValue(this.draft.seriesName).onChange(v => {
					this.draft.seriesName = v;
				}),
			);

		new Setting(contentEl)
			.setName('Notes folder override')
			.setDesc('Leave blank to use the global meetings folder.')
			.addText(t =>
				t
					.setPlaceholder('Meetings/Standups')
					.setValue(this.draft.noteFolderOverride ?? '')
					.onChange(v => {
						this.draft.noteFolderOverride = v.trim() || undefined;
					}),
			);

		new Setting(contentEl)
			.setName('Template override')
			.setDesc('Vault path to a custom template for this series.')
			.addText(t =>
				t
					.setPlaceholder('Templates/Standup.md')
					.setValue(this.draft.templateOverride ?? '')
					.onChange(v => {
						this.draft.templateOverride = v.trim() || undefined;
					}),
			);

		new Setting(contentEl)
			.setName('Default agenda')
			.setDesc('Markdown text pre-filled in the AGENDA block.')
			.addTextArea(t =>
				t
					.setPlaceholder('- Topic 1\n- Topic 2')
					.setValue(this.draft.defaultAgenda ?? '')
					.onChange(v => {
						this.draft.defaultAgenda = v.trim() || undefined;
					}),
			);

		new Setting(contentEl)
			.setName('Tags')
			.setDesc('Comma-separated tags to add to each meeting note.')
			.addText(t =>
				t
					.setPlaceholder('standup, engineering')
					.setValue((this.draft.tags ?? []).join(', '))
					.onChange(v => {
						this.draft.tags = v.split(',').map(s => s.trim()).filter(Boolean);
					}),
			);

		new Setting(contentEl)
			.setName('Hidden attendees')
			.setDesc('Comma-separated emails to exclude from the Attendees block.')
			.addText(t =>
				t
					.setPlaceholder('bot@company.com')
					.setValue((this.draft.hiddenAttendees ?? []).join(', '))
					.onChange(v => {
						this.draft.hiddenAttendees = v.split(',').map(s => s.trim()).filter(Boolean);
					}),
			);

		new Setting(contentEl)
			.setName('Pinned attendees')
			.setDesc('Comma-separated emails always included in the Attendees block.')
			.addText(t =>
				t
					.setPlaceholder('lead@company.com')
					.setValue((this.draft.pinnedAttendees ?? []).join(', '))
					.onChange(v => {
						this.draft.pinnedAttendees = v.split(',').map(s => s.trim()).filter(Boolean);
					}),
			);

		new Setting(contentEl)
			.addButton(btn =>
				btn.setButtonText('Save').setCta().onClick(async () => {
					await this.onSave(this.draft);
					this.close();
				}),
			)
			.addButton(btn =>
				btn.setButtonText('Cancel').onClick(() => this.close()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
