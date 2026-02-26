/**
 * Settings Tab for Calendar Bridge.
 *
 * Renders all plugin settings including:
 *   - Calendar source management (ICS / Google OAuth)
 *   - Sync options (horizon, auto-sync, startup)
 *   - Path / folder options
 *   - Format options
 *   - Feature toggles
 *   - Privacy options
 */

import {
	App,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	Setting,
} from 'obsidian';
import {
	CalendarSourceConfig,
	GoogleApiSettings,
	IcsSourceSettings,
	PluginSettings,
	SourceType,
} from './types';

// Re-export so main.ts can import from a single settings module
export type { PluginSettings };
export { DEFAULT_SETTINGS } from './types';

// ─── Plugin interface ──────────────────────────────────────────────────────────

/** Parts of CalendarBridgePlugin that the settings tab needs. */
interface CalendarBridgePluginLike extends Plugin {
	settings: PluginSettings;
	saveSettings(): Promise<void>;
	triggerSync(): Promise<void>;
}

// ─── Default sub-configs ───────────────────────────────────────────────────────

function defaultGoogle(): GoogleApiSettings {
	return {
		clientId: '',
		clientSecret: '',
		accessToken: undefined,
		refreshToken: undefined,
		tokenExpiry: undefined,
		selectedCalendarIds: [],
		includeConferenceData: true,
	};
}

function defaultIcs(): IcsSourceSettings {
	return {
		url: '',
		pollIntervalMinutes: 60,
	};
}

function newSource(type: SourceType): CalendarSourceConfig {
	const base = {
		id: `source-${Date.now()}`,
		name: type === 'gcal_api' ? 'Google Calendar' : 'ICS Feed',
		sourceType: type,
		enabled: true,
	};
	if (type === 'gcal_api') return { ...base, google: defaultGoogle() };
	return { ...base, ics: defaultIcs() };
}

// ─── Settings Tab ──────────────────────────────────────────────────────────────

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

		this.renderSourcesSection(containerEl);
		this.renderSyncSection(containerEl);
		this.renderPathsSection(containerEl);
		this.renderFormatSection(containerEl);
		this.renderFeaturesSection(containerEl);
		this.renderPrivacySection(containerEl);
		this.renderActionsSection(containerEl);
	}

	// ─── Calendar Sources ──────────────────────────────────────────────────────

	private renderSourcesSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Calendar Sources').setHeading();

		containerEl.createEl('p', {
			text: 'Add Google Calendar (OAuth) or ICS feed sources. Each source is synced independently.',
			cls: 'setting-item-description',
		});

		const sources = this.plugin.settings.sources;
		sources.forEach((source, index) => {
			this.renderSource(containerEl, source, index);
		});

		// Add source buttons
		const addRow = new Setting(containerEl);
		addRow
			.addButton(btn =>
				btn
					.setButtonText('＋ Add ICS feed')
					.onClick(async () => {
						this.plugin.settings.sources.push(newSource('ics_public'));
						await this.plugin.saveSettings();
						this.display();
					}),
			)
			.addButton(btn =>
				btn
					.setButtonText('＋ Add Google Calendar')
					.onClick(async () => {
						this.plugin.settings.sources.push(newSource('gcal_api'));
						await this.plugin.saveSettings();
						this.display();
					}),
			);
	}

	private renderSource(
		containerEl: HTMLElement,
		source: CalendarSourceConfig,
		index: number,
	): void {
		const wrapper = containerEl.createDiv({ cls: 'calendar-bridge-source' });
		wrapper.style.border = '1px solid var(--background-modifier-border)';
		wrapper.style.borderRadius = '6px';
		wrapper.style.padding = '12px';
		wrapper.style.marginBottom = '12px';

		// Header row: enable toggle + type label + delete
		const headerLabel =
			source.sourceType === 'gcal_api'
				? '🗓 Google Calendar'
				: source.sourceType === 'ics_secret'
					? '🔒 Private ICS'
					: '📡 ICS Feed';

		new Setting(wrapper)
			.setName(`Source ${index + 1} — ${headerLabel}`)
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
						this.plugin.settings.sources.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		// Name
		new Setting(wrapper)
			.setName('Display name')
			.addText(t =>
				t
					.setPlaceholder('My Calendar')
					.setValue(source.name)
					.onChange(async v => {
						source.name = v;
						await this.plugin.saveSettings();
					}),
			);

		// Source-type selector
		new Setting(wrapper)
			.setName('Source type')
			.setDesc('ICS Public: any public .ics URL. ICS Private: secret/sign URL. Google: OAuth 2.0.')
			.addDropdown(d =>
				d
					.addOption('ics_public', 'ICS — Public feed')
					.addOption('ics_secret', 'ICS — Private/secret URL')
					.addOption('gcal_api', 'Google Calendar (OAuth)')
					.setValue(source.sourceType)
					.onChange(async (v: string) => {
						const newType = v as SourceType;
						source.sourceType = newType;
						// Ensure sub-config exists
						if (newType === 'gcal_api' && !source.google) {
							source.google = defaultGoogle();
						} else if (newType !== 'gcal_api' && !source.ics) {
							source.ics = defaultIcs();
						}
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		// ICS-specific fields
		if (source.sourceType === 'ics_public' || source.sourceType === 'ics_secret') {
			this.renderIcsFields(wrapper, source);
		}

		// Google-specific fields
		if (source.sourceType === 'gcal_api') {
			this.renderGoogleFields(wrapper, source);
		}
	}

	private renderIcsFields(wrapper: HTMLElement, source: CalendarSourceConfig): void {
		if (!source.ics) source.ics = defaultIcs();
		const ics = source.ics;

		new Setting(wrapper)
			.setName('ICS URL')
			.setDesc(
				source.sourceType === 'ics_secret'
					? '⚠ This URL acts as a password — treat it as a secret.'
					: 'Public .ics feed URL (e.g. Google Calendar export URL).',
			)
			.addText(t =>
				t
					.setPlaceholder('https://…/basic.ics')
					.setValue(ics.url)
					.onChange(async v => {
						ics.url = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(wrapper)
			.setName('Poll interval (minutes)')
			.setDesc('How often to re-fetch this ICS feed during auto-sync. 0 = every sync.')
			.addSlider(s =>
				s
					.setLimits(0, 1440, 15)
					.setValue(ics.pollIntervalMinutes)
					.setDynamicTooltip()
					.onChange(async v => {
						ics.pollIntervalMinutes = v;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderGoogleFields(wrapper: HTMLElement, source: CalendarSourceConfig): void {
		if (!source.google) source.google = defaultGoogle();
		const g = source.google;

		if (!Platform.isDesktopApp) {
			wrapper.createEl('p', {
				text: '⚠ Google OAuth is available on desktop only. Use ICS export for mobile.',
				cls: 'mod-warning',
			});
			return;
		}

		new Setting(wrapper)
			.setName('Client ID')
			.setDesc('From Google Cloud Console → Credentials → OAuth 2.0 Client ID.')
			.addText(t =>
				t
					.setPlaceholder('….apps.googleusercontent.com')
					.setValue(g.clientId)
					.onChange(async v => {
						g.clientId = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(wrapper)
			.setName('Client Secret')
			.setDesc('⚠ Stored in plain text in this vault. Keep this vault private.')
			.addText(t => {
				t
					.setPlaceholder('GOCSPX-…')
					.setValue(g.clientSecret)
					.onChange(async v => {
						g.clientSecret = v.trim();
						await this.plugin.saveSettings();
					});
				// Mask the input
				t.inputEl.type = 'password';
			});

		// Token status
		const tokenStatus = g.accessToken
			? `✓ Authorized${g.tokenExpiry ? ' (expires ' + new Date(g.tokenExpiry).toLocaleString() + ')' : ''}`
			: '✗ Not authorized';

		new Setting(wrapper)
			.setName('Authorization')
			.setDesc(tokenStatus)
			.addButton(btn =>
				btn
					.setButtonText(g.accessToken ? 'Re-authorize' : 'Authorize')
					.setCta()
					.onClick(async () => {
						if (!g.clientId || !g.clientSecret) {
							new Notice('Calendar Bridge: Enter Client ID and Client Secret first.');
							return;
						}
						await this.startOAuthFlow(source);
					}),
			)
			.addButton(btn =>
				btn
					.setButtonText('Revoke')
					.setWarning()
					.setDisabled(!g.accessToken)
					.onClick(async () => {
						g.accessToken = undefined;
						g.refreshToken = undefined;
						g.tokenExpiry = undefined;
						await this.plugin.saveSettings();
						new Notice('Calendar Bridge: Token revoked.');
						this.display();
					}),
			);

		new Setting(wrapper)
			.setName('Include conference data')
			.setDesc('Fetch Google Meet / Zoom join links from event conferenceData.')
			.addToggle(t =>
				t.setValue(g.includeConferenceData).onChange(async v => {
					g.includeConferenceData = v;
					await this.plugin.saveSettings();
				}),
			);
	}

	/**
	 * Starts a simplified OAuth 2.0 authorization code flow using the system browser.
	 * The user pastes the redirect URL back into a prompt.
	 */
	private async startOAuthFlow(source: CalendarSourceConfig): Promise<void> {
		if (!source.google) return;
		const g = source.google;

		const redirectUri = 'urn:ietf:wg:oauth:2.0:oob';
		const scope = encodeURIComponent(
			'https://www.googleapis.com/auth/calendar.readonly',
		);
		const authUrl =
			`https://accounts.google.com/o/oauth2/v2/auth` +
			`?client_id=${encodeURIComponent(g.clientId)}` +
			`&redirect_uri=${encodeURIComponent(redirectUri)}` +
			`&response_type=code` +
			`&scope=${scope}` +
			`&access_type=offline` +
			`&prompt=consent`;

		// Open in browser
		window.open(authUrl, '_blank');

		// Ask user to paste the code
		const code = await this.promptForInput(
			'Paste the authorization code from Google here:',
		);
		if (!code) return;

		try {
			const resp = await fetch('https://oauth2.googleapis.com/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					code,
					client_id: g.clientId,
					client_secret: g.clientSecret,
					redirect_uri: redirectUri,
					grant_type: 'authorization_code',
				}).toString(),
			});

			if (!resp.ok) {
				const err = await resp.text();
				new Notice(`Calendar Bridge: OAuth failed — ${err}`);
				return;
			}

			const data = await resp.json() as {
				access_token: string;
				refresh_token?: string;
				expires_in?: number;
			};

			g.accessToken = data.access_token;
			if (data.refresh_token) g.refreshToken = data.refresh_token;
			if (data.expires_in) g.tokenExpiry = Date.now() + data.expires_in * 1000;

			await this.plugin.saveSettings();
			new Notice('Calendar Bridge: Google Calendar authorized ✓');
			this.display();
		} catch (err) {
			new Notice(`Calendar Bridge: OAuth error — ${(err as Error).message}`);
		}
	}

	/** Shows a modal-like prompt using a simple browser dialog. */
	private promptForInput(message: string): Promise<string | null> {
		return new Promise(resolve => {
			// Use a simple modal overlay built into the settings panel
			const overlay = document.body.createDiv({ cls: 'calendar-bridge-prompt' });
			overlay.style.cssText =
				'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;';

			const box = overlay.createDiv();
			box.style.cssText =
				'background:var(--background-primary);padding:24px;border-radius:8px;min-width:400px;max-width:600px;';

			box.createEl('p', { text: message });
			const input = box.createEl('input', { type: 'text' });
			input.style.cssText = 'width:100%;margin:8px 0 16px;';
			input.placeholder = 'Paste code here…';

			const btnRow = box.createDiv();
			btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

			const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
			const okBtn = btnRow.createEl('button', { text: 'OK' });
			okBtn.style.cssText = 'background:var(--interactive-accent);color:var(--text-on-accent);border:none;padding:4px 12px;border-radius:4px;cursor:pointer;';

			const finish = (value: string | null): void => {
				overlay.remove();
				resolve(value);
			};

			cancelBtn.addEventListener('click', () => finish(null));
			okBtn.addEventListener('click', () => finish(input.value.trim() || null));
			input.addEventListener('keydown', e => {
				if (e.key === 'Enter') finish(input.value.trim() || null);
				if (e.key === 'Escape') finish(null);
			});

			document.body.appendChild(overlay);
			input.focus();
		});
	}

	// ─── Sync settings ─────────────────────────────────────────────────────────

	private renderSyncSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Sync').setHeading();

		new Setting(containerEl)
			.setName('Sync horizon (days)')
			.setDesc('How many days ahead of today to fetch and generate notes.')
			.addSlider(s =>
				s
					.setLimits(1, 90, 1)
					.setValue(this.plugin.settings.horizonDays)
					.setDynamicTooltip()
					.onChange(async v => {
						this.plugin.settings.horizonDays = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Auto-sync interval (minutes)')
			.setDesc('How often to automatically sync in the background. 0 = disabled.')
			.addSlider(s =>
				s
					.setLimits(0, 1440, 15)
					.setValue(this.plugin.settings.autoSyncIntervalMinutes)
					.setDynamicTooltip()
					.onChange(async v => {
						this.plugin.settings.autoSyncIntervalMinutes = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Sync on startup')
			.setDesc('Automatically run a sync when Obsidian opens.')
			.addToggle(t =>
				t.setValue(this.plugin.settings.syncOnStartup).onChange(async v => {
					this.plugin.settings.syncOnStartup = v;
					await this.plugin.saveSettings();
				}),
			);
	}

	// ─── Paths ─────────────────────────────────────────────────────────────────

	private renderPathsSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Paths').setHeading();

		new Setting(containerEl)
			.setName('Meetings root folder')
			.setDesc('Vault folder where individual meeting notes are created (date sub-folders are created automatically).')
			.addText(t =>
				t
					.setPlaceholder('Meetings')
					.setValue(this.plugin.settings.meetingsRoot)
					.onChange(async v => {
						this.plugin.settings.meetingsRoot = v.trim() || 'Meetings';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Series root folder')
			.setDesc('Vault folder where recurring-series index pages are created.')
			.addText(t =>
				t
					.setPlaceholder('Meetings/_series')
					.setValue(this.plugin.settings.seriesRoot)
					.onChange(async v => {
						this.plugin.settings.seriesRoot = v.trim() || 'Meetings/_series';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Template note path')
			.setDesc('Vault path to a custom note template. Leave blank to use the built-in template.')
			.addText(t =>
				t
					.setPlaceholder('Templates/Meeting.md')
					.setValue(this.plugin.settings.templatePath)
					.onChange(async v => {
						this.plugin.settings.templatePath = v.trim();
						await this.plugin.saveSettings();
					}),
			);
	}

	// ─── Format ────────────────────────────────────────────────────────────────

	private renderFormatSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Format').setHeading();

		new Setting(containerEl)
			.setName('Date folder format')
			.setDesc('Sub-folder name inside the meetings root. Tokens: YYYY, MM, DD.')
			.addText(t =>
				t
					.setPlaceholder('YYYY-MM-DD')
					.setValue(this.plugin.settings.dateFolderFormat)
					.onChange(async v => {
						this.plugin.settings.dateFolderFormat = v.trim() || 'YYYY-MM-DD';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('File name format')
			.setDesc('Template for the note file name. Tokens: {time}, {series}, {title}.')
			.addText(t =>
				t
					.setPlaceholder('{time} [{series}] {title}')
					.setValue(this.plugin.settings.fileNameFormat)
					.onChange(async v => {
						this.plugin.settings.fileNameFormat = v.trim() || '{time} [{series}] {title}';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Date format')
			.setDesc('Displayed inside note content. Tokens: YYYY, MM, DD.')
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
			.setDesc('Displayed inside note content. Tokens: HH (24-hour), mm.')
			.addText(t =>
				t
					.setPlaceholder('HH:mm')
					.setValue(this.plugin.settings.timeFormat)
					.onChange(async v => {
						this.plugin.settings.timeFormat = v.trim() || 'HH:mm';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Default timezone')
			.setDesc('IANA timezone for events without explicit TZ (e.g. America/New_York). Leave blank to use system timezone.')
			.addText(t =>
				t
					.setPlaceholder('America/New_York')
					.setValue(this.plugin.settings.timezoneDefault)
					.onChange(async v => {
						this.plugin.settings.timezoneDefault = v.trim();
						await this.plugin.saveSettings();
					}),
			);
	}

	// ─── Features ──────────────────────────────────────────────────────────────

	private renderFeaturesSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Features').setHeading();

		new Setting(containerEl)
			.setName('Generate series pages')
			.setDesc('Create and maintain an index page for each recurring meeting series.')
			.addToggle(t =>
				t.setValue(this.plugin.settings.enableSeriesPages).onChange(async v => {
					this.plugin.settings.enableSeriesPages = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Add prev / next links')
			.setDesc('Insert previous and next occurrence links in each meeting note.')
			.addToggle(t =>
				t.setValue(this.plugin.settings.enablePrevNextLinks).onChange(async v => {
					this.plugin.settings.enablePrevNextLinks = v;
					await this.plugin.saveSettings();
				}),
			);
	}

	// ─── Privacy ───────────────────────────────────────────────────────────────

	private renderPrivacySection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Privacy').setHeading();

		new Setting(containerEl)
			.setName('Redaction mode')
			.setDesc(
				'When enabled, attendee email addresses and conference join links are NOT written to notes. ' +
				'Useful when vault is synced to a shared location.',
			)
			.addToggle(t =>
				t.setValue(this.plugin.settings.redactionMode).onChange(async v => {
					this.plugin.settings.redactionMode = v;
					await this.plugin.saveSettings();
				}),
			);

		containerEl.createEl('p', {
			text:
				'⚠ OAuth tokens and secret ICS URLs are stored in plain text in your Obsidian data directory. ' +
				'Do not sync your vault to untrusted locations when using these features.',
			cls: 'setting-item-description',
		});
	}

	// ─── Actions ───────────────────────────────────────────────────────────────

	private renderActionsSection(containerEl: HTMLElement): void {
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
}
