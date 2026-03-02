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
import { maskClientId, parseGoogleCredentialsJson } from './gcal-credentials';

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
		clientId: '',

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
				res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Calendar Bridge — Authorized</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d1117;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #e6edf3;
    padding: 24px;
  }
  .card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 40px 48px;
    max-width: 440px;
    width: 100%;
    text-align: center;
    animation: fadeUp .35s cubic-bezier(.16,1,.3,1) both;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .icon {
    width: 56px;
    height: 56px;
    background: #1a7f37;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 24px;
    animation: pop .4s .2s cubic-bezier(.34,1.56,.64,1) both;
  }
  @keyframes pop {
    from { opacity: 0; transform: scale(.4); }
    to   { opacity: 1; transform: scale(1); }
  }
  .icon svg { display: block; }
  h1 {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.25;
    color: #e6edf3;
    margin-bottom: 8px;
  }
  p {
    font-size: 14px;
    color: #8b949e;
    line-height: 1.6;
  }
  .divider {
    border: none;
    border-top: 1px solid #21262d;
    margin: 28px 0;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #58a6ff;
    text-decoration: none;
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
  }
  .back:hover { color: #79c0ff; }
  .wordmark {
    font-size: 12px;
    color: #484f58;
    margin-top: 32px;
    letter-spacing: .02em;
  }
  .close-hint {
    font-size: 13px;
    color: #58a6ff;
    margin-top: 4px;
  }
</style>
<script>
  // Attempt auto-close. Works if the tab was opened via window.open();
  // silently ignored by browsers when opened externally — the text fallback covers that case.
  try { window.close(); } catch (_) {}
</script>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 12.6L9 17.6L20 6.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>Authorization successful</h1>
    <p>Calendar Bridge is now connected to your Google Calendar. You may close this tab and return to Obsidian.</p>
    <hr class="divider">
    <p class="close-hint">You can now close this tab and return to Obsidian.</p>
    <p class="wordmark">Calendar Bridge for Obsidian</p>
  </div>
</body>
</html>`);
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

	// ─── Field helpers ──────────────────────────────────────────────────────────

	/**
	 * Renders a numeric text input that clamps to [min, max] on blur.
	 * The input is 80px wide for compactness.
	 */
	private addNumericSetting(
		el: HTMLElement,
		opts: {
			name: string;
			desc: string;
			min: number;
			max: number;
			defaultVal: number;
			get: () => number;
			set: (v: number) => Promise<void>;
		},
	): void {
		new Setting(el)
			.setName(opts.name)
			.setDesc(opts.desc)
			.addText(t => {
				t.inputEl.type = 'number';
				t.inputEl.min = String(opts.min);
				t.inputEl.max = String(opts.max);
				t.inputEl.style.width = '80px';
				t.setValue(String(opts.get()));
				t.inputEl.addEventListener('blur', async () => {
					let v = parseInt(t.inputEl.value, 10);
					if (isNaN(v)) v = opts.defaultVal;
					v = Math.max(opts.min, Math.min(opts.max, v));
					t.setValue(String(v));
					await opts.set(v);
				});
			});
	}

	/** Renders a text input with folder autocomplete. */
	private addFolderSetting(
		el: HTMLElement,
		opts: {
			name: string;
			desc: string;
			placeholder: string;
			get: () => string;
			set: (v: string) => Promise<void>;
		},
	): void {
		new Setting(el)
			.setName(opts.name)
			.setDesc(opts.desc)
			.addText(t => {
				t.setPlaceholder(opts.placeholder).setValue(opts.get());
				new FolderSuggest(this.app, t.inputEl);
				t.onChange(async v => opts.set(v.trim() || opts.placeholder));
			});
	}

	/** Renders a text input with file autocomplete. */
	private addFileSetting(
		el: HTMLElement,
		opts: {
			name: string;
			desc: string;
			placeholder: string;
			get: () => string;
			set: (v: string) => Promise<void>;
		},
	): void {
		new Setting(el)
			.setName(opts.name)
			.setDesc(opts.desc)
			.addText(t => {
				t.setPlaceholder(opts.placeholder).setValue(opts.get());
				new FileSuggest(this.app, t.inputEl);
				t.onChange(async v => opts.set(v.trim()));
			});
	}

	/** Renders a plain text input. */
	private addTextSetting(
		el: HTMLElement,
		opts: {
			name: string;
			desc: string;
			placeholder: string;
			get: () => string;
			set: (v: string) => Promise<void>;
		},
	): void {
		new Setting(el)
			.setName(opts.name)
			.setDesc(opts.desc)
			.addText(t =>
				t
					.setPlaceholder(opts.placeholder)
					.setValue(opts.get())
					.onChange(async v => opts.set(v.trim())),
			);
	}

	/** Renders a toggle setting. */
	private addToggleSetting(
		el: HTMLElement,
		opts: {
			name: string;
			desc: string;
			get: () => boolean;
			set: (v: boolean) => Promise<void>;
		},
	): void {
		new Setting(el)
			.setName(opts.name)
			.setDesc(opts.desc)
			.addToggle(t => t.setValue(opts.get()).onChange(opts.set));
	}

	/**
	 * Creates a bordered card container for a calendar source.
	 * All styling via CSS variables so it respects Obsidian themes.
	 */
	private makeCardEl(parent: HTMLElement): HTMLElement {
		const card = parent.createDiv({ cls: 'calendar-bridge-source' });
		card.style.cssText = [
			'border: 1px solid var(--background-modifier-border)',
			'border-radius: 8px',
			'padding: 12px 16px',
			'margin-bottom: 12px',
		].join(';');
		return card;
	}

	// ─── Top-level display ──────────────────────────────────────────────────────

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Calendar Bridge').setHeading();

		this.renderSourcesSection(containerEl);
		this.renderSyncSection(containerEl);
		this.renderPathsSection(containerEl);
		this.renderFormatSection(containerEl);
		this.renderFeaturesSection(containerEl);
		this.renderSeriesNoteSection(containerEl);
		this.renderPrivacySection(containerEl);
		this.renderActionsSection(containerEl);
	}

	// ─── Calendar Sources ──────────────────────────────────────────────────────

	private renderSourcesSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Calendar Sources')
			.setHeading()
			.setDesc('Add Google Calendar (OAuth) or ICS feed sources. Each source is synced independently.');

		const sources = this.plugin.settings.sources;
		sources.forEach((source, index) => {
			this.renderSource(containerEl, source, index);
		});

		new Setting(containerEl)
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
		const card = this.makeCardEl(containerEl);

		// Header row: enable toggle + type label + delete
		const headerLabel =
			source.sourceType === 'gcal_api'
				? '🗓 Google Calendar'
				: source.sourceType === 'ics_secret'
					? '🔒 Private ICS'
					: '📡 ICS Feed';

		new Setting(card)
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

		// Display name
		this.addTextSetting(card, {
			name: 'Display name',
			desc: 'Human-readable label for this source.',
			placeholder: 'My Calendar',
			get: () => source.name,
			set: async v => {
				source.name = v;
				await this.plugin.saveSettings();
			},
		});

		// Source type dropdown
		new Setting(card)
			.setName('Source type')
			.setDesc('ICS Public: any public .ics URL. ICS Private: secret/signed URL. Google: OAuth 2.0.')
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
			this.renderIcsFields(card, source);
		}

		// Google-specific fields
		if (source.sourceType === 'gcal_api') {
			this.renderGoogleFields(card, source);
		}
	}

	private renderIcsFields(card: HTMLElement, source: CalendarSourceConfig): void {
		if (!source.ics) source.ics = defaultIcs();
		const ics = source.ics;

		this.addTextSetting(card, {
			name: 'ICS URL',
			desc:
				source.sourceType === 'ics_secret'
					? '⚠ This URL acts as a password — treat it as a secret.'
					: 'Public .ics feed URL (e.g. Google Calendar export URL).',
			placeholder: 'https://…/basic.ics',
			get: () => ics.url,
			set: async v => {
				ics.url = v;
				await this.plugin.saveSettings();
			},
		});

		new Setting(card)
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

	private renderGoogleFields(card: HTMLElement, source: CalendarSourceConfig): void {
		if (!source.google) source.google = defaultGoogle();
		const g = source.google;

		if (!Platform.isDesktopApp) {
			card.createEl('p', {
				text: '⚠ Google OAuth is available on desktop only. Use ICS export for mobile.',
				cls: 'mod-warning',
			});
			return;
		}

		// ── Credentials sub-heading ──────────────────────────────────────────────
		new Setting(card)
			.setName('Google OAuth (Dev / Advanced)')
			.setHeading()
			.setDesc(
				'Download your OAuth credentials JSON from Google Cloud Console → APIs & Services → Credentials, ' +
				'then load it below. No manual typing. Credentials are stored locally only.',
			);

		// ── Drag-drop zone ───────────────────────────────────────────────────────
		const dropZone = card.createDiv({ cls: 'calendar-bridge-drop-zone' });
		dropZone.style.cssText = [
			'border: 2px dashed var(--background-modifier-border)',
			'border-radius: 6px',
			'padding: 16px 20px',
			'text-align: center',
			'margin: 8px 0 12px',
			'cursor: pointer',
			'transition: border-color 0.15s, background 0.15s',
			'user-select: none',
		].join(';');

		const dropLabel = dropZone.createEl('p', {
			text: g.googleCredsFileName
				? `📄 ${g.googleCredsFileName}  (loaded)`
				: 'Drag & drop your Google OAuth credentials JSON here',
			cls: 'setting-item-description',
		});
		dropLabel.style.cssText = 'margin: 0; font-size: 13px;';

		const hint = dropZone.createEl('p', {
			text: g.googleCredsFileName ? '' : 'or click "Choose JSON file…" below',
			cls: 'setting-item-description',
		});
		hint.style.cssText = 'margin: 4px 0 0; font-size: 12px; color: var(--text-faint);';

		dropZone.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			dropZone.style.borderColor = 'var(--interactive-accent)';
			dropZone.style.background = 'var(--background-secondary)';
			dropLabel.setText('Drop file to load credentials');
		});
		dropZone.addEventListener('dragleave', () => {
			dropZone.style.borderColor = 'var(--background-modifier-border)';
			dropZone.style.background = '';
			dropLabel.setText(
				g.googleCredsFileName
					? `📄 ${g.googleCredsFileName}  (loaded)`
					: 'Drag & drop your Google OAuth credentials JSON here',
			);
		});
		dropZone.addEventListener('drop', async (e: DragEvent) => {
			e.preventDefault();
			dropZone.style.borderColor = 'var(--background-modifier-border)';
			dropZone.style.background = '';
			const file = e.dataTransfer?.files?.[0];
			if (!file) return;
			if (!file.name.endsWith('.json')) {
				new Notice('Calendar Bridge: Only .json files are accepted.');
				return;
			}
			await this.loadCredentialsFile(file, g, source);
			if (authBtn) authBtn.setDisabled(!g.clientId);
			this.display();
		});

		// ── File picker button ───────────────────────────────────────────────────
		let authBtn: import('obsidian').ButtonComponent | undefined;
		new Setting(card)
			.addButton(btn =>
				btn
					.setButtonText('Choose JSON file…')
					.onClick(async () => {
						try {
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							const electron = (window as any).require?.('electron');
							if (!electron?.remote && !electron?.ipcRenderer) {
								throw new Error('Electron not available.');
							}
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							const { dialog } = electron.remote ?? await (electron.ipcRenderer as any).invoke('get-dialog');
							const result = await dialog.showOpenDialog({
								properties: ['openFile'],
								filters: [{ name: 'JSON Credentials', extensions: ['json'] }],
								title: 'Select Google OAuth Credentials JSON',
							});
							if (result.canceled || !result.filePaths[0]) return;
							const filePath: string = result.filePaths[0];
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							const fs = (window as any).require?.('fs');
							if (!fs) throw new Error('Node fs not available.');
							const raw: string = await fs.promises.readFile(filePath, 'utf-8');
							const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
							await this.applyCredentialsJson(raw, fileName, g, source);
							if (authBtn) authBtn.setDisabled(!g.clientId);
							this.display();
						} catch (err) {
							new Notice(`Calendar Bridge: Could not open file — ${(err as Error).message}`);
						}
					}),
			);

		// ── Loaded credentials status ────────────────────────────────────────────
		if (g.googleCredsFileName) {
			const typeLabel =
				g.googleClientType === 'installed' ? 'installed (Desktop app)' :
				g.googleClientType === 'web'       ? 'web (Web application — secret required)' :
				'unknown';
			const clientIdMasked = g.clientId ? maskClientId(g.clientId) : '—';

			new Setting(card)
				.setName('Loaded credentials')
				.setDesc(
					`File: ${g.googleCredsFileName} · ` +
					`Type: ${typeLabel} · ` +
					`Client ID: ${clientIdMasked} · ` +
					`Secret: ${g.googleClientSecret ? 'yes' : 'no'}`,
				);
		}

		// ── Authorization status ─────────────────────────────────────────────────
		const canAuth = !!g.clientId;
		const authStatus = !canAuth
			? '⚠ Load credentials above to enable authorization.'
			: g.accessToken
				? (g.tokenExpiry
					? (Date.now() < g.tokenExpiry
						? `✓ Authorized (expires ${new Date(g.tokenExpiry).toLocaleString()})`
						: `↻ Token present but expired — re-authorize`)
					: '✓ Authorized')
				: '✗ Not authorized';

		const authSetting = new Setting(card)
			.setName('Authorization')
			.setDesc(authStatus)
			.addButton(btn => {
				authBtn = btn;
				btn
					.setButtonText(g.accessToken ? 'Re-authorize' : 'Authorize')
					.setCta()
					.setDisabled(!canAuth)
					.onClick(async () => {
						await this.startOAuthFlow(source);
					});
			})
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
			)
			.addButton(btn =>
				btn
					.setButtonText('Clear credentials')
					.setDisabled(!g.googleCredsFileName && !g.clientId)
					.onClick(async () => {
						g.clientId = '';
						g.googleClientSecret = undefined;
						g.googleClientType = undefined;
						g.googleCredsFileName = undefined;
						g.accessToken = undefined;
						g.refreshToken = undefined;
						g.tokenExpiry = undefined;
						await this.plugin.saveSettings();
						new Notice('Calendar Bridge: Credentials cleared.');
						this.display();
					}),
			);

		// ── Test Connection ──────────────────────────────────────────────────────
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

		// ── Preview upcoming events ──────────────────────────────────────────────
		new Setting(card)
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
							for (const cal of cals.slice(0, 3)) {
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

		// ── Include conference data ──────────────────────────────────────────────
		this.addToggleSetting(card, {
			name: 'Include conference data',
			desc: 'Fetch Google Meet / Zoom join links from event conferenceData.',
			get: () => g.includeConferenceData,
			set: async v => {
				g.includeConferenceData = v;
				await this.plugin.saveSettings();
			},
		});
	}

	/**
	 * Load a File object (from drag-drop) and apply parsed credentials.
	 */
	private async loadCredentialsFile(
		file: File,
		g: GoogleApiSettings,
		source: CalendarSourceConfig,
	): Promise<void> {
		return new Promise((resolve) => {
			const reader = new FileReader();
			reader.onload = async (ev) => {
				const raw = ev.target?.result as string | undefined;
				if (!raw) {
					new Notice('Calendar Bridge: Could not read file.');
					return resolve();
				}
				await this.applyCredentialsJson(raw, file.name, g, source);
				resolve();
			};
			reader.onerror = () => {
				new Notice('Calendar Bridge: File read error.');
				resolve();
			};
			reader.readAsText(file);
		});
	}

	/**
	 * Parse and apply a credentials JSON string to the GoogleApiSettings object.
	 */
	private async applyCredentialsJson(
		raw: string,
		fileName: string,
		g: GoogleApiSettings,
		source: CalendarSourceConfig,
	): Promise<void> {
		try {
			const creds = parseGoogleCredentialsJson(raw);
			g.clientId = creds.clientId;
			g.googleClientType = creds.type;
			g.googleClientSecret = creds.clientSecret;
			g.googleCredsFileName = fileName;
			// Write back into the plugin settings array
			const idx = this.plugin.settings.sources.findIndex(s => s.id === source.id);
			if (idx !== -1) this.plugin.settings.sources[idx].google = { ...g };
			await this.plugin.saveSettings();
			const typeLabel = creds.type === 'installed' ? 'Desktop app' : 'Web application';
			new Notice(
				`Calendar Bridge: Credentials loaded — ${typeLabel}` +
				(creds.clientSecret ? ' (with secret)' : ' (no secret / PKCE only)'),
			);
		} catch (err) {
			new Notice(`Calendar Bridge: Invalid credentials file — ${(err as Error).message}`);
		}
	}

	/**
	 * Starts an OAuth 2.0 PKCE authorization code flow using the system browser +
	 * a loopback HTTP server (no client_secret — Desktop app OAuth client).
	 */
	private async startOAuthFlow(source: CalendarSourceConfig): Promise<void> {
		if (!source.google) return;
		const g = source.google;
		if (!g.clientId) {
			new Notice('Calendar Bridge: Enter Client ID in settings first.');
			return;
		}

		const port = randomPort();
		console.log('[CalendarBridge] Starting OAuth flow on port', port);

		const adapter = new GoogleCalendarAdapter({
			id: source.id,
			name: source.name,
			settings: g,
			onSettingsUpdate: async (updated) => {
				console.log('[CalendarBridge] onSettingsUpdate called, accessToken present:', !!updated.accessToken);
				Object.assign(g, updated);
				// Also write back into the plugin settings array directly
				const idx = this.plugin.settings.sources.findIndex(s => s.id === source.id);
				if (idx !== -1) {
					this.plugin.settings.sources[idx].google = { ...g };
				}
				await this.plugin.saveSettings();
				console.log('[CalendarBridge] saveSettings() completed');
			},
		});

		let authUrl: string;
		try {
			authUrl = await adapter.getAuthorizationUrlAsync(port);
			console.log('[CalendarBridge] Auth URL built:', authUrl.slice(0, 80) + '…');
		} catch (err) {
			new Notice(`Calendar Bridge: Failed to build auth URL — ${(err as Error).message}`);
			return;
		}

		new Notice('Calendar Bridge: Opening browser for Google authorization…');
		openExternalUrl(authUrl);

		let code: string;
		try {
			code = await startLoopbackServer(port);
			console.log('[CalendarBridge] Auth code received, length:', code.length);
			new Notice('Calendar Bridge: Code received, exchanging for tokens…');
		} catch (err) {
			new Notice(`Calendar Bridge: Authorization failed — ${(err as Error).message}`);
			return;
		}

		try {
			await adapter.exchangeCodeForTokens(code, port);
			console.log('[CalendarBridge] Token exchange succeeded, accessToken:', !!g.accessToken);
			new Notice('Calendar Bridge: Google Calendar authorized ✓');
			this.display();
		} catch (err) {
			console.error('[CalendarBridge] exchangeCodeForTokens threw:', err);
			new Notice(`Calendar Bridge: Token exchange failed — ${(err as Error).message}`);
		}
	}

	// ─── Sync settings ─────────────────────────────────────────────────────────

	private renderSyncSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Sync').setHeading();

		this.addNumericSetting(containerEl, {
			name: 'Sync horizon (days)',
			desc: 'How many days ahead of today to fetch and generate notes.',
			min: 1,
			max: 60,
			defaultVal: 5,
			get: () => this.plugin.settings.horizonDays,
			set: async v => {
				this.plugin.settings.horizonDays = v;
				await this.plugin.saveSettings();
			},
		});

		this.addNumericSetting(containerEl, {
			name: 'Auto-sync interval (minutes)',
			desc: 'How often to automatically sync in the background. 0 = disabled.',
			min: 0,
			max: 1440,
			defaultVal: 60,
			get: () => this.plugin.settings.autoSyncIntervalMinutes,
			set: async v => {
				this.plugin.settings.autoSyncIntervalMinutes = v;
				await this.plugin.saveSettings();
			},
		});

		this.addToggleSetting(containerEl, {
			name: 'Sync on startup',
			desc: 'Automatically run a sync when Obsidian opens.',
			get: () => this.plugin.settings.syncOnStartup,
			set: async v => {
				this.plugin.settings.syncOnStartup = v;
				await this.plugin.saveSettings();
			},
		});
	}

	// ─── Paths ─────────────────────────────────────────────────────────────────

	private renderPathsSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Paths').setHeading();

		this.addFolderSetting(containerEl, {
			name: 'Meetings root folder',
			desc: 'Vault folder where individual meeting notes are created (date sub-folders are created automatically).',
			placeholder: 'Meetings',
			get: () => this.plugin.settings.meetingsRoot,
			set: async v => {
				this.plugin.settings.meetingsRoot = v;
				await this.plugin.saveSettings();
			},
		});

		this.addFolderSetting(containerEl, {
			name: 'Series root folder',
			desc: 'Vault folder where recurring-series index pages are created.',
			placeholder: 'Meetings/_series',
			get: () => this.plugin.settings.seriesRoot,
			set: async v => {
				this.plugin.settings.seriesRoot = v;
				await this.plugin.saveSettings();
			},
		});

		this.addFileSetting(containerEl, {
			name: 'Template note path',
			desc: 'Vault path to a custom note template. Leave blank to use the built-in template.',
			placeholder: 'Templates/Meeting.md',
			get: () => this.plugin.settings.templatePath,
			set: async v => {
				this.plugin.settings.templatePath = v;
				await this.plugin.saveSettings();
			},
		});

		new Setting(containerEl)
			.setName('Contacts folder')
			.setDesc('Folder (including sub-folders) containing Person notes with an `email:` frontmatter field. Matched attendees appear as [[PersonNote]] wikilinks in meeting notes. Leave blank to disable.')
			.addText(t => {
				t.setPlaceholder('People').setValue(this.plugin.settings.contactsFolder);
				new FolderSuggest(this.app, t.inputEl);
				t.onChange(async v => {
					this.plugin.settings.contactsFolder = v.trim();
					await this.plugin.saveSettings();
				});
			});
	}

	// ─── Format ────────────────────────────────────────────────────────────────

	private renderFormatSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Format').setHeading();

		this.addTextSetting(containerEl, {
			name: 'Date folder format',
			desc: 'Sub-folder name inside the meetings root. Tokens: YYYY, MM, DD.',
			placeholder: 'YYYY-MM-DD',
			get: () => this.plugin.settings.dateFolderFormat,
			set: async v => {
				this.plugin.settings.dateFolderFormat = v || 'YYYY-MM-DD';
				await this.plugin.saveSettings();
			},
		});

		this.addTextSetting(containerEl, {
			name: 'Date format',
			desc: 'Displayed inside note content. Tokens: YYYY, MM, DD.',
			placeholder: 'YYYY-MM-DD',
			get: () => this.plugin.settings.dateFormat,
			set: async v => {
				this.plugin.settings.dateFormat = v || 'YYYY-MM-DD';
				await this.plugin.saveSettings();
			},
		});

		this.addTextSetting(containerEl, {
			name: 'Time format',
			desc: 'Displayed inside note content. Tokens: HH (24-hour), mm.',
			placeholder: 'HH:mm',
			get: () => this.plugin.settings.timeFormat,
			set: async v => {
				this.plugin.settings.timeFormat = v || 'HH:mm';
				await this.plugin.saveSettings();
			},
		});

		this.addTextSetting(containerEl, {
			name: 'Default timezone',
			desc: 'IANA timezone for events without explicit TZ (e.g. America/New_York). Leave blank to use system timezone.',
			placeholder: 'America/New_York',
			get: () => this.plugin.settings.timezoneDefault,
			set: async v => {
				this.plugin.settings.timezoneDefault = v;
				await this.plugin.saveSettings();
			},
		});
	}

	// ─── Features ──────────────────────────────────────────────────────────────

	private renderFeaturesSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Features').setHeading();

		this.addToggleSetting(containerEl, {
			name: 'Generate series pages',
			desc: 'Create and maintain an index page for each recurring meeting series.',
			get: () => this.plugin.settings.enableSeriesPages,
			set: async v => {
				this.plugin.settings.enableSeriesPages = v;
				await this.plugin.saveSettings();
			},
		});

		this.addToggleSetting(containerEl, {
			name: 'Add prev / next links',
			desc: 'Insert previous and next occurrence links in each meeting note.',
			get: () => this.plugin.settings.enablePrevNextLinks,
			set: async v => {
				this.plugin.settings.enablePrevNextLinks = v;
				await this.plugin.saveSettings();
			},
		});
		this.addToggleSetting(containerEl, {
			name: 'Auto-expire stale decisions in context',
			desc: 'When enabled, decisions with a past embedded date are excluded from CB_CONTEXT.',
			get: () => this.plugin.settings.contextDropExpiredDecisionsByDate,
			set: async v => {
				this.plugin.settings.contextDropExpiredDecisionsByDate = v;
				await this.plugin.saveSettings();
			},
		});

		this.addNumericSetting(containerEl, {
			name: 'Decision horizon (days)',
			desc: 'Decisions from notes older than this many days are excluded from CB_CONTEXT (unless sticky).',
			min: 1,
			max: 365,
			defaultVal: 14,
			get: () => this.plugin.settings.contextDecisionHorizonDays,
			set: async v => {
				this.plugin.settings.contextDecisionHorizonDays = Math.max(1, Math.min(365, v));
				await this.plugin.saveSettings();
			},
		});

		this.addNumericSetting(containerEl, {
			name: 'Context lookback notes',
			desc: 'Number of previous meeting notes to scan when building CB_CONTEXT.',
			min: 1,
			max: 50,
			defaultVal: 10,
			get: () => this.plugin.settings.contextDecisionLookbackNotes,
			set: async v => {
				this.plugin.settings.contextDecisionLookbackNotes = Math.max(1, Math.min(50, v));
				await this.plugin.saveSettings();
			},
		});

		this.addTextSetting(containerEl, {
			name: 'Sticky decision token',
			desc: 'Decisions containing this token are always included in CB_CONTEXT regardless of age. Token is hidden in rendered output.',
			placeholder: '!sticky',
			get: () => this.plugin.settings.contextStickyToken,
			set: async v => {
				this.plugin.settings.contextStickyToken = v.trim() || '!sticky';
				await this.plugin.saveSettings();
			},
		});
	}

	// ─── Series note aggregation settings ──────────────────────────────────────

	private renderSeriesNoteSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Series Note Aggregation').setHeading();

		this.addFileSetting(containerEl, {
			name: 'Series template path',
			desc: 'If specified, this template will be used when creating new series notes. If empty or invalid, the built-in default template is used.',
			placeholder: '_series/_templates/Series.md',
			get: () => this.plugin.settings.seriesTemplatePath,
			set: async v => {
				this.plugin.settings.seriesTemplatePath = v;
				await this.plugin.saveSettings();
			},
		});

		new Setting(containerEl)
			.setName('Meeting link format')
			.setDesc('How meeting links are displayed in the series Meetings index. "Date only" shows just the date; "Date · Title" shows both.')
			.addDropdown(d =>
				d
					.addOption('date', 'Date only  (2026-03-04)')
					.addOption('date-title', 'Date · Title  (2026-03-04 · Meeting Name)')
					.setValue(this.plugin.settings.seriesLinkFormat ?? 'date-title')
					.onChange(async (v: string) => {
						this.plugin.settings.seriesLinkFormat = v as 'date' | 'date-title';
						await this.plugin.saveSettings();
					}),
			);

		this.addTextSetting(containerEl, {
			name: 'Series action marker',
			desc: 'Block-reference tag that marks a task for aggregation into the series note. Add this tag to any task in a meeting note.',
			placeholder: '^series',
			get: () => this.plugin.settings.seriesActionMarker,
			set: async v => {
				this.plugin.settings.seriesActionMarker = v.trim() || '^series';
				await this.plugin.saveSettings();
			},
		});

		this.addNumericSetting(containerEl, {
			name: 'Series decision horizon (days)',
			desc: 'Decisions from notes older than this many days are excluded from the series note (unless sticky).',
			min: 1,
			max: 365,
			defaultVal: 30,
			get: () => this.plugin.settings.seriesDecisionHorizonDays,
			set: async v => {
				this.plugin.settings.seriesDecisionHorizonDays = Math.max(1, Math.min(365, v));
				await this.plugin.saveSettings();
			},
		});

		this.addNumericSetting(containerEl, {
			name: 'Series decision lookback notes',
			desc: 'Number of previous meeting notes to scan when building the series decisions block.',
			min: 1,
			max: 100,
			defaultVal: 20,
			get: () => this.plugin.settings.seriesDecisionLookbackNotes,
			set: async v => {
				this.plugin.settings.seriesDecisionLookbackNotes = Math.max(1, Math.min(100, v));
				await this.plugin.saveSettings();
			},
		});

		this.addToggleSetting(containerEl, {
			name: 'Auto-expire stale series decisions',
			desc: 'When enabled, decisions with a past embedded date are excluded from the series note.',
			get: () => this.plugin.settings.seriesDropExpiredDecisionsByDate,
			set: async v => {
				this.plugin.settings.seriesDropExpiredDecisionsByDate = v;
				await this.plugin.saveSettings();
			},
		});
	}

	// ─── Privacy ───────────────────────────────────────────────────────────────

	private renderPrivacySection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Privacy').setHeading();

		this.addToggleSetting(containerEl, {
			name: 'Redaction mode',
			desc:
				'When enabled, attendee email addresses and conference join links are NOT written to notes. ' +
				'Useful when vault is synced to a shared location.',
			get: () => this.plugin.settings.redactionMode,
			set: async v => {
				this.plugin.settings.redactionMode = v;
				await this.plugin.saveSettings();
			},
		});

		new Setting(containerEl)
			.setDesc(
				'⚠ OAuth tokens and secret ICS URLs are stored in plain text in your Obsidian data directory. ' +
				'Do not sync your vault to untrusted locations when using these features.',
			);
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
