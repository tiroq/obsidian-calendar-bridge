/**
 * StatusHeader — always-visible top bar of the Calendar Bridge panel.
 *
 * Left:  Google / Connected status (green/red dot), account email,
 *        "N / M selected" calendars, "Next sync in Xm Ys"
 * Right: 🔄 Sync now, ⚙ Open Settings, ⟳ Reconnect buttons
 *        Warning badge if no calendars selected
 */

import { App } from 'obsidian';
import { RichCalendarItem, GoogleApiSettings } from '../../../types';
import { SyncStore } from '../stores/SyncStore';

export interface StatusHeaderOptions {
	app: App;
	/** Google source settings (null = no gcal source configured). */
	gcalSettings: GoogleApiSettings | null;
	calendars: RichCalendarItem[];
	syncStore: SyncStore;
	onOpenSettings: () => void;
	onReconnect: () => void;
}

export class StatusHeader {
	private container: HTMLElement;
	private opts: StatusHeaderOptions;
	private unsub: (() => void) | null = null;
	private nextSyncHandle = 0;

	constructor(parent: HTMLElement, opts: StatusHeaderOptions) {
		this.opts = opts;
		this.container = parent.createDiv({ cls: 'cb-status-header' });
		this.container.style.cssText = [
			'display:flex',
			'align-items:flex-start',
			'justify-content:space-between',
			'gap:8px',
			'padding:10px 12px 8px',
			'border-bottom:1px solid var(--background-modifier-border)',
		].join(';');

		this.render();

		// Re-render whenever sync state changes
		this.unsub = opts.syncStore.subscribe(() => this.render());
	}

	private render(): void {
		this.container.empty();

		const left = this.container.createDiv();
		left.style.cssText = 'display:flex;flex-direction:column;gap:3px;min-width:0;';

		// ── Connection status row ───────────────────────────────────────────────
		const statusRow = left.createDiv();
		statusRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';

		const { gcalSettings } = this.opts;
		const isConnected = !!(gcalSettings?.accessToken);

		const dot = statusRow.createSpan();
		dot.style.cssText = [
			'width:8px',
			'height:8px',
			'border-radius:50%',
			'flex-shrink:0',
			`background:${isConnected ? 'var(--color-green)' : 'var(--color-red)'}`,
		].join(';');

		const statusLabel = statusRow.createSpan();
		statusLabel.style.cssText = 'font-size:12px;font-weight:600;color:var(--text-normal);';
		statusLabel.setText(isConnected ? 'Connected' : 'Not connected');

		if (gcalSettings?.clientId) {
			const email = statusRow.createSpan();
			email.style.cssText = 'font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			// Show masked client_id as account hint (email not available from OAuth token alone)
			const maskedId = gcalSettings.clientId.slice(0, 8) + '…';
			email.setText(`(${maskedId})`);
		}

		// ── Calendars count row ─────────────────────────────────────────────────
		const { calendars } = this.opts;
		const selectedCount = calendars.filter(c => {
			const gcalSrc = this.opts.gcalSettings;
			return gcalSrc?.selectedCalendarIds?.includes(c.id) ?? false;
		}).length;
		const totalCount = calendars.length;

		const calRow = left.createDiv();
		calRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

		const calLabel = calRow.createSpan();
		calLabel.style.cssText = 'font-size:11px;color:var(--text-muted);';
		calLabel.setText(`${selectedCount} / ${totalCount} calendars selected`);

		if (totalCount > 0 && selectedCount === 0) {
			const warn = calRow.createSpan();
			warn.style.cssText = 'font-size:11px;color:var(--color-orange);font-weight:600;';
			warn.setText('⚠ None selected');
		}

		// ── Right: action buttons ───────────────────────────────────────────────
		const right = this.container.createDiv();
		right.style.cssText = 'display:flex;align-items:flex-start;gap:4px;flex-shrink:0;';

		const btnStyle = [
			'background:none',
			'border:none',
			'cursor:pointer',
			'padding:4px 6px',
			'border-radius:4px',
			'font-size:14px',
			'color:var(--text-muted)',
			'line-height:1',
		].join(';');

		const syncBtn = right.createEl('button');
		syncBtn.style.cssText = btnStyle;
		syncBtn.setAttribute('aria-label', 'Sync now');
		syncBtn.setText('🔄');
		syncBtn.addEventListener('click', () => this.opts.syncStore.triggerSync());
		syncBtn.addEventListener('mouseenter', () => { syncBtn.style.color = 'var(--text-accent)'; syncBtn.style.background = 'var(--background-modifier-hover)'; });
		syncBtn.addEventListener('mouseleave', () => { syncBtn.style.color = 'var(--text-muted)'; syncBtn.style.background = 'none'; });

		const settingsBtn = right.createEl('button');
		settingsBtn.style.cssText = btnStyle;
		settingsBtn.setAttribute('aria-label', 'Open settings');
		settingsBtn.setText('⚙');
		settingsBtn.addEventListener('click', () => this.opts.onOpenSettings());
		settingsBtn.addEventListener('mouseenter', () => { settingsBtn.style.color = 'var(--text-accent)'; settingsBtn.style.background = 'var(--background-modifier-hover)'; });
		settingsBtn.addEventListener('mouseleave', () => { settingsBtn.style.color = 'var(--text-muted)'; settingsBtn.style.background = 'none'; });

		if (isConnected) {
			const reconnectBtn = right.createEl('button');
			reconnectBtn.style.cssText = btnStyle;
			reconnectBtn.setAttribute('aria-label', 'Reconnect');
			reconnectBtn.setText('⟳');
			reconnectBtn.addEventListener('click', () => this.opts.onReconnect());
			reconnectBtn.addEventListener('mouseenter', () => { reconnectBtn.style.color = 'var(--text-accent)'; reconnectBtn.style.background = 'var(--background-modifier-hover)'; });
			reconnectBtn.addEventListener('mouseleave', () => { reconnectBtn.style.color = 'var(--text-muted)'; reconnectBtn.style.background = 'none'; });
		}
	}

	/** Update calendars list (called when CalendarStore refreshes). */
	updateCalendars(calendars: RichCalendarItem[]): void {
		this.opts.calendars = calendars;
		this.render();
	}

	/** Update gcal settings (called when reconnect/disconnect happens). */
	updateGcalSettings(settings: GoogleApiSettings | null): void {
		this.opts.gcalSettings = settings;
		this.render();
	}

	destroy(): void {
		this.unsub?.();
		if (this.nextSyncHandle) window.clearInterval(this.nextSyncHandle);
	}
}
