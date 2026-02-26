/**
 * Settings Tab for Calendar Bridge.
 *
 * Renders all plugin settings including:
 *   - Calendar source management (ICS / Google OAuth)
 *   - Sync options (horizon, auto-sync, startup)
 *   - Path / folder options (with FolderSuggest / FileSuggest)
 *   - Format options
 *   - Feature toggles
 *   - Privacy options
 */

import {
	AbstractInputSuggest,
	App,
	Modal,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
} from 'obsidian';
import {
	CalendarSourceConfig,
	GoogleApiSettings,
	IcsSourceSettings,
	NormalizedEvent,
	PluginSettings,
	SourceType,
} from './types';
import { GoogleCalendarAdapter } from './sources/gcal-source';

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

// ─── Folder / File suggest ─────────────────────────────────────────────────────

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, private inputEl: HTMLInputElement) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFolder[] {
		const lq = query.toLowerCase();
		return this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder)
			.filter(f => f.path.toLowerCase().includes(lq))
			.slice(0, 20);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.inputEl.dispatchEvent(new Event('input'));
		this.close();
	}
}

class FileSuggest extends AbstractInputSuggest<TFile> {
	constructor(app: App, private inputEl: HTMLInputElement) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFile[] {
		const lq = query.toLowerCase();
		return this.app.vault.getMarkdownFiles()
			.filter(f => f.path.toLowerCase().includes(lq))
			.slice(0, 20);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.setValue(file.path);
		this.inputEl.dispatchEvent(new Event('input'));
		this.close();
	}
}

// ─── Default sub-configs ───────────────────────────────────────────────────────

function defaultGoogle(): GoogleApiSettings {
	return {
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

// ─── Loopback OAuth helpers ───────────────────────────────────────────────────

/** Open a URL in the system browser via Electron shell, fallback to window.open. */
function openExternalUrl(url: string): void {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const electron = (window as any).require?.('electron');
		if (electron?.shell?.openExternal) {
			void electron.shell.openExternal(url);
			return;
		}
	} catch { /* fall through */ }
	window.open(url, '_blank');
}

/**
 * Spin up a local HTTP server on the given port, wait for the OAuth redirect
 * containing ?code=…, close the server, and return the code.
 * Times out after 5 minutes.
 */
function startLoopbackServer(port: number): Promise<string> {
	return new Promise((resolve, reject) => {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const http = (window as any).require?.('http');
			if (!http) {
				reject(new Error('Node http module unavailable (desktop only).'));
				return;
			}

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const server = http.createServer((req: any, res: any) => {
				try {
					const reqUrl = new URL(req.url as string, `http://127.0.0.1:${port}`);
					const code = reqUrl.searchParams.get('code');
					const error = reqUrl.searchParams.get('error');

					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
					res.end(
						'<html><body style="font-family:sans-serif;padding:2em">' +
						'<h2>Calendar Bridge — authorization complete.</h2>' +
						'<p>You may close this tab and return to Obsidian.</p>' +
						'</body></html>',
					);
					server.close();

					if (code) resolve(code);
					else reject(new Error(error ?? 'OAuth cancelled or no code received.'));
				} catch (e) {
					reject(e as Error);
				}
			});

			server.listen(port, '127.0.0.1');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			server.on('error', (err: any) => reject(err as Error));

			// 5-minute timeout
			const timer = setTimeout(() => {
				server.close();
				reject(new Error('OAuth timed out after 5 minutes.'));
			}, 5 * 60 * 1000);

			// Allow Node process to exit even if timer is pending
			if (timer.unref) timer.unref();
		} catch (e) {
			reject(e as Error);
		}
	});
}

/** Pick a random port in the ephemeral range 49152–65535. */
function randomPort(): number {
	return Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
}

// ─── Preview events modal ─────────────────────────────────────────────────────

class PreviewEventsModal extends Modal {
	constructor(app: App, private lines: string[]) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Upcoming events (next 7 days)' });
		if (this.lines.length === 0) {
			contentEl.createEl('p', { text: 'No events found in the next 7 days.' });
		} else {
			const ul = contentEl.createEl('ul');
			for (const line of this.lines) {
				ul.createEl('li', { text: line });
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
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

		// Auth status line
		const authStatus = g.accessToken
			? (g.tokenExpiry
				? (Date.now() < g.tokenExpiry
					? `✓ Authorized (expires ${new Date(g.tokenExpiry).toLocaleString()})`
					: `↻ Token present but expired — re-authorize`)
				: '✓ Authorized')
			: '✗ Not authorized';

		const authSetting = new Setting(wrapper)
			.setName('Authorization')
			.setDesc(authStatus)
			.addButton(btn =>
				btn
					.setButtonText(g.accessToken ? 'Re-authorize' : 'Authorize')
					.setCta()
					.onClick(async () => {
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

		// Test Connection button
		authSetting.addButton(btn =>
			btn
				.setButtonText('Test Connection')
				.setDisabled(!g.accessToken)
				.onClick(async () => {
					if (!g.accessToken) return;
					btn.setDisabled(true).setButtonText('Testing…');
					try {
						const adapter = new GoogleCalendarAdapter({
							id: 'test',
							name: 'test',
							settings: g,
							onSettingsUpdate: async () => { /* no-op */ },
						});
						const result = await adapter.testConnection();
						new Notice(result.ok
							? `Calendar Bridge: ${result.message}`
							: `Calendar Bridge: Connection failed — ${result.message}`);
					} finally {
						btn.setDisabled(false).setButtonText('Test Connection');
					}
				}),
		);

		// Preview upcoming events button
		new Setting(wrapper)
			.setName('Preview upcoming events')
			.setDesc('Fetch and display the next 5 events from all selected calendars (requires authorization).')
			.addButton(btn =>
				btn
					.setButtonText('Preview')
					.setDisabled(!g.accessToken)
					.onClick(async () => {
						if (!g.accessToken) return;
						btn.setDisabled(true).setButtonText('Loading…');
						try {
							const adapter = new GoogleCalendarAdapter({
								id: 'preview',
								name: 'preview',
								settings: g,
								onSettingsUpdate: async (updated) => {
									Object.assign(g, updated);
									await this.plugin.saveSettings();
								},
							});
							const cals = await adapter.listCalendars();
							const now = new Date();
							const weekLater = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
							const allEvents: NormalizedEvent[] = [];
							for (const cal of cals.slice(0, 3)) { // limit to 3 cals for preview
								const evts = await adapter.listEvents(cal.id, now, weekLater);
								allEvents.push(...evts);
							}
							allEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
							const top5 = allEvents.slice(0, 5);
							const lines = top5.map(e => {
								const d = e.startDate.toLocaleDateString();
								const t = e.isAllDay ? 'All day' : e.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
								return `${d} ${t} — ${e.title}`;
							});
							new PreviewEventsModal(this.app, lines).open();
						} catch (err) {
							new Notice(`Calendar Bridge: Preview failed — ${(err as Error).message}`);
						} finally {
							btn.setDisabled(false).setButtonText('Preview');
						}
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
	 * Starts an OAuth 2.0 authorization code flow using the system browser +
	 * a loopback HTTP server (no copy-paste required).
	 */
	/**
	 * Starts an OAuth 2.0 PKCE authorization code flow using the system browser +
	 * a loopback HTTP server (no copy-paste, no client secret required).
	 */
	private async startOAuthFlow(source: CalendarSourceConfig): Promise<void> {
		if (!source.google) return;
		const g = source.google;

		const port = randomPort();

		const adapter = new GoogleCalendarAdapter({
			id: source.id,
			name: source.name,
			settings: g,
			onSettingsUpdate: async (updated) => {
				Object.assign(g, updated);
				await this.plugin.saveSettings();
			},
		});

		let authUrl: string;
		try {
			authUrl = await adapter.getAuthorizationUrlAsync(port);
		} catch (err) {
			new Notice(`Calendar Bridge: Failed to build auth URL — ${(err as Error).message}`);
			return;
		}

		new Notice('Calendar Bridge: Opening browser for Google authorization…');
		openExternalUrl(authUrl);

		let code: string;
		try {
			code = await startLoopbackServer(port);
		} catch (err) {
			new Notice(`Calendar Bridge: Authorization failed — ${(err as Error).message}`);
			return;
		}

		try {
			await adapter.exchangeCodeForTokens(code, port);
			new Notice('Calendar Bridge: Google Calendar authorized ✓');
			this.display();
		} catch (err) {
			new Notice(`Calendar Bridge: Token exchange failed — ${(err as Error).message}`);
		}
	}

	// ─── Sync settings ─────────────────────────────────────────────────────────

	private renderSyncSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Sync').setHeading();

		// Horizon days — numeric input + Default button
		new Setting(containerEl)
			.setName('Sync horizon (days)')
			.setDesc('How many days ahead of today to fetch and generate notes.')
			.addText(t => {
				t.setValue(String(this.plugin.settings.horizonDays));
				t.inputEl.type = 'number';
				t.inputEl.min = '1';
				t.inputEl.max = '60';
				t.inputEl.style.width = '80px';
				t.inputEl.addEventListener('blur', async () => {
					let v = parseInt(t.inputEl.value, 10);
					if (isNaN(v)) v = 5;
					v = Math.max(1, Math.min(60, v));
					t.setValue(String(v));
					this.plugin.settings.horizonDays = v;
					await this.plugin.saveSettings();
				});
			})
			.addButton(btn =>
				btn.setButtonText('Default (5)').onClick(async () => {
					this.plugin.settings.horizonDays = 5;
					await this.plugin.saveSettings();
					new Notice('Calendar Bridge: Sync horizon reset to 5 days.');
					this.display();
				}),
			);

		// Auto-sync interval — numeric input
		new Setting(containerEl)
			.setName('Auto-sync interval (minutes)')
			.setDesc('How often to automatically sync in the background. 0 = disabled.')
			.addText(t => {
				t.setValue(String(this.plugin.settings.autoSyncIntervalMinutes));
				t.inputEl.type = 'number';
				t.inputEl.min = '0';
				t.inputEl.max = '1440';
				t.inputEl.style.width = '80px';
				t.inputEl.addEventListener('blur', async () => {
					let v = parseInt(t.inputEl.value, 10);
					if (isNaN(v)) v = 0;
					v = Math.max(0, Math.min(1440, v));
					t.setValue(String(v));
					this.plugin.settings.autoSyncIntervalMinutes = v;
					await this.plugin.saveSettings();
				});
			});

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

		// Meetings root — folder suggest
		const meetingsSetting = new Setting(containerEl)
			.setName('Meetings root folder')
			.setDesc('Vault folder where individual meeting notes are created (date sub-folders are created automatically).')
			.addText(t => {
				t.setPlaceholder('Meetings').setValue(this.plugin.settings.meetingsRoot);
				new FolderSuggest(this.app, t.inputEl);
				t.onChange(async v => {
					this.plugin.settings.meetingsRoot = v.trim() || 'Meetings';
					await this.plugin.saveSettings();
				});
			});
		meetingsSetting.controlEl.addClass('calendar-bridge-path-setting');

		// Series root — folder suggest
		const seriesSetting = new Setting(containerEl)
			.setName('Series root folder')
			.setDesc('Vault folder where recurring-series index pages are created.')
			.addText(t => {
				t.setPlaceholder('Meetings/_series').setValue(this.plugin.settings.seriesRoot);
				new FolderSuggest(this.app, t.inputEl);
				t.onChange(async v => {
					this.plugin.settings.seriesRoot = v.trim() || 'Meetings/_series';
					await this.plugin.saveSettings();
				});
			});
		seriesSetting.controlEl.addClass('calendar-bridge-path-setting');

		// Template path — file suggest
		const templateSetting = new Setting(containerEl)
			.setName('Template note path')
			.setDesc('Vault path to a custom note template. Leave blank to use the built-in template.')
			.addText(t => {
				t.setPlaceholder('Templates/Meeting.md').setValue(this.plugin.settings.templatePath);
				new FileSuggest(this.app, t.inputEl);
				t.onChange(async v => {
					this.plugin.settings.templatePath = v.trim();
					await this.plugin.saveSettings();
				});
			});
		templateSetting.controlEl.addClass('calendar-bridge-path-setting');
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
