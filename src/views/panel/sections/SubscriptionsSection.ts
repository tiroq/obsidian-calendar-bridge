/**
 * SubscriptionsSection — collapsible panel section for per-series / per-event
 * sync opt-in control.
 *
 * Shows all known series and single events from the subscription profiles
 * with a checkbox to enable/disable sync for each.
 *
 * After a sync, if new unseen series or events are found (newCandidates),
 * a dismissible banner prompts the user to review and opt them in.
 */

import { NormalizedEvent, SeriesProfile, RichCalendarItem } from '../../../types';
import { CalendarStore } from '../stores/CalendarStore';

export interface SubscriptionsSectionCallbacks {
	/** Returns all persisted profiles (enabled + disabled). */
	getProfiles: () => Record<string, SeriesProfile>;
	/** Enable a series/event by seriesKey. */
	enableSeries: (seriesKey: string, name: string) => Promise<void>;
	/** Disable a series/event by seriesKey. */
	disableSeries: (seriesKey: string) => Promise<void>;
	/** Upsert a full profile (used when accepting a new candidate). */
	upsertProfile: (profile: SeriesProfile) => Promise<void>;
}

export interface SubscriptionsSectionOptions {
	calendarStore: CalendarStore;
	callbacks: SubscriptionsSectionCallbacks;
}

/** One display item rendered in the list. */
interface DisplayItem {
	seriesKey: string;
	name: string;
	isRecurring: boolean;
	calendarId: string;
	occurrenceCount: number;
	isNew: boolean;     // not yet in profiles — from newCandidates
	enabled: boolean;
}

export class SubscriptionsSection {
	private details: HTMLElement;
	private bodyEl!: HTMLElement;
	private listContainer!: HTMLElement;
	private bannerEl: HTMLElement | null = null;

	private opts: SubscriptionsSectionOptions;
	private unsub: () => void;

	/** New candidates from the most recent sync — not yet in profiles. */
	private newCandidates: NormalizedEvent[] = [];

	constructor(parent: HTMLElement, opts: SubscriptionsSectionOptions) {
		this.opts = opts;

		this.details = parent.createEl('details');
		this.details.style.cssText = 'border-bottom:1px solid var(--background-modifier-border);';

		this.buildSummary();
		this.buildBody();

		// Re-render when calendar list changes (color dots update)
		this.unsub = opts.calendarStore.subscribe(() => {
			this.renderList();
		});
	}

	// ─── Public API ─────────────────────────────────────────────────────────────

	/**
	 * Called after each sync with events that were not in the subscription
	 * profiles. Displays a review banner and adds them to the list.
	 */
	updateCandidates(newItems: NormalizedEvent[]): void {
		if (newItems.length === 0) return;

		// Merge — avoid duplicates by seriesKey
		const existingKeys = new Set(this.newCandidates.map(e => e.seriesKey));
		for (const item of newItems) {
			if (!existingKeys.has(item.seriesKey)) {
				this.newCandidates.push(item);
				existingKeys.add(item.seriesKey);
			}
		}

		this.renderBanner();
		this.renderList();
		this.expand();
	}

	/** Expand the section. */
	expand(): void {
		(this.details as HTMLDetailsElement).open = true;
	}

	/** Scroll the section into view. */
	scrollIntoView(): void {
		this.details.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	/** Re-render the list (e.g. after external profile changes). */
	refresh(): void {
		this.renderBanner();
		this.renderList();
		this.updateSummaryCount();
	}

	destroy(): void {
		this.unsub();
	}

	// ─── Build ───────────────────────────────────────────────────────────────────

	private buildSummary(): void {
		const summary = this.details.createEl('summary');
		summary.style.cssText = [
			'display:flex',
			'align-items:center',
			'justify-content:space-between',
			'padding:8px 12px',
			'cursor:pointer',
			'user-select:none',
			'font-size:12px',
			'font-weight:600',
			'color:var(--text-normal)',
			'list-style:none',
		].join(';');
		summary.setAttribute('data-cb-summary', 'subscriptions');

		const left = summary.createSpan();
		left.setText('Series & Events');

		const right = summary.createSpan({ cls: 'cb-subs-count' });
		right.style.cssText = 'font-size:11px;color:var(--text-muted);font-weight:400;';
		this.updateSummaryCountEl(right);
	}

	private buildBody(): void {
		this.bodyEl = this.details.createDiv();
		this.bodyEl.style.cssText = 'padding:6px 12px 10px;';

		// Controls row
		const controls = this.bodyEl.createDiv();
		controls.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;';

		const btnStyle = [
			'font-size:11px',
			'padding:2px 7px',
			'border-radius:3px',
			'border:1px solid var(--background-modifier-border)',
			'background:var(--background-secondary)',
			'cursor:pointer',
			'color:var(--text-muted)',
		].join(';');

		const allBtn = controls.createEl('button');
		allBtn.style.cssText = btnStyle;
		allBtn.setText('Enable all');
		allBtn.addEventListener('click', () => this.enableAll());

		const noneBtn = controls.createEl('button');
		noneBtn.style.cssText = btnStyle;
		noneBtn.setText('Disable all');
		noneBtn.addEventListener('click', () => this.disableAll());

		// New-candidates banner placeholder (inserted before list)
		this.bannerEl = this.bodyEl.createDiv({ cls: 'cb-subs-banner' });
		this.bannerEl.style.cssText = 'display:none;';

		// List
		this.listContainer = this.bodyEl.createDiv({ cls: 'cb-subs-list' });
		this.renderList();
	}

	// ─── Render ──────────────────────────────────────────────────────────────────

	private renderBanner(): void {
		if (!this.bannerEl) return;
		this.bannerEl.empty();

		// Filter candidates that haven't been accepted/dismissed yet
		const profiles = this.opts.callbacks.getProfiles();
		const pending = this.newCandidates.filter(c => !profiles[c.seriesKey]);

		if (pending.length === 0) {
			this.bannerEl.style.cssText = 'display:none;';
			return;
		}

		this.bannerEl.style.cssText = [
			'display:flex',
			'align-items:flex-start',
			'justify-content:space-between',
			'gap:8px',
			'padding:8px 10px',
			'margin-bottom:8px',
			'border-radius:4px',
			'background:var(--background-modifier-info)',
			'border:1px solid var(--interactive-accent)',
			'font-size:11px',
			'color:var(--text-normal)',
		].join(';');

		const msg = this.bannerEl.createSpan();
		msg.setText(`🔔 ${pending.length} new ${pending.length === 1 ? 'item' : 'items'} detected. Review and enable below.`);

		const dismissBtn = this.bannerEl.createEl('button');
		dismissBtn.style.cssText = [
			'font-size:10px',
			'padding:1px 6px',
			'border-radius:3px',
			'border:1px solid var(--background-modifier-border)',
			'background:var(--background-secondary)',
			'cursor:pointer',
			'color:var(--text-muted)',
			'flex-shrink:0',
		].join(';');
		dismissBtn.setText('Dismiss');
		dismissBtn.addEventListener('click', async () => {
			// Mark all pending candidates as disabled (user saw them)
			for (const c of pending) {
				await this.opts.callbacks.upsertProfile({
					seriesKey: c.seriesKey,
					seriesName: c.title,
					enabled: false,
				});
			}
			this.newCandidates = this.newCandidates.filter(c => profiles[c.seriesKey]);
			this.renderBanner();
			this.renderList();
			this.updateSummaryCount();
		});
	}

	private renderList(): void {
		this.listContainer.empty();

		const profiles = this.opts.callbacks.getProfiles();
		const calendars = this.opts.calendarStore.getCalendars();
		const calMap = new Map<string, RichCalendarItem>(calendars.map(c => [c.id, c]));

		// Build display items: from persisted profiles + from newCandidates not yet in profiles
		const itemMap = new Map<string, DisplayItem>();

		// 1. All persisted profiles
		for (const [key, profile] of Object.entries(profiles)) {
			itemMap.set(key, {
				seriesKey: key,
				name: profile.seriesName,
				isRecurring: !key.startsWith('single:'),
				calendarId: '',
				occurrenceCount: 0,
				isNew: false,
				enabled: profile.enabled,
			});
		}

		// 2. New candidates not yet in profiles
		// Group by seriesKey to count occurrences
		const candidateMap = new Map<string, { event: NormalizedEvent; count: number }>();
		for (const c of this.newCandidates) {
			const ex = candidateMap.get(c.seriesKey);
			if (!ex) {
				candidateMap.set(c.seriesKey, { event: c, count: 1 });
			} else {
				ex.count++;
			}
		}

		for (const [key, { event, count }] of candidateMap) {
			if (itemMap.has(key)) {
				// Already in profiles — update occurrence count
				const existing = itemMap.get(key)!;
				existing.occurrenceCount = count;
				existing.calendarId = event.calendarId;
			} else {
				itemMap.set(key, {
					seriesKey: key,
					name: event.title,
					isRecurring: event.isRecurring,
					calendarId: event.calendarId,
					occurrenceCount: count,
					isNew: true,
					enabled: false,
				});
			}
		}

		if (itemMap.size === 0) {
			const empty = this.listContainer.createDiv();
			empty.style.cssText = 'font-size:11px;color:var(--text-faint);padding:4px 0;';
			empty.setText('No series or events yet. Run a sync to discover them.');
			return;
		}

		// Sort: new items first, then by name
		const items = [...itemMap.values()].sort((a, b) => {
			if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
			if (a.isRecurring !== b.isRecurring) return a.isRecurring ? -1 : 1;
			return a.name.localeCompare(b.name);
		});

		for (const item of items) {
			this.renderItem(item, calMap);
		}
	}

	private renderItem(item: DisplayItem, calMap: Map<string, RichCalendarItem>): void {
		const cal = calMap.get(item.calendarId);
		const color = cal?.backgroundColor ?? 'var(--interactive-accent)';

		const row = this.listContainer.createDiv({ cls: 'cb-sub-row' });
		row.style.cssText = [
			'display:flex',
			'align-items:flex-start',
			'gap:8px',
			'padding:5px 0',
			item.isNew ? 'background:var(--background-modifier-info-hover);border-radius:3px;padding-left:4px;' : '',
		].join(';');

		// Checkbox
		const cb = row.createEl('input');
		cb.type = 'checkbox';
		cb.checked = item.enabled;
		cb.style.cssText = 'flex-shrink:0;margin-top:2px;cursor:pointer;';

		// Color dot
		const dot = row.createSpan();
		dot.style.cssText = [
			'width:10px',
			'height:10px',
			'border-radius:50%',
			'flex-shrink:0',
			'margin-top:3px',
			`background:${color}`,
		].join(';');

		// Text block
		const textBlock = row.createDiv();
		textBlock.style.cssText = 'flex:1;min-width:0;';

		const nameEl = textBlock.createDiv();
		nameEl.style.cssText = 'font-size:12px;font-weight:600;color:var(--text-normal);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
		nameEl.setText(item.name);

		const metaEl = textBlock.createDiv();
		metaEl.style.cssText = 'display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px;';

		// Type badge
		const typeBadge = metaEl.createSpan();
		typeBadge.style.cssText = [
			'font-size:10px',
			'padding:1px 4px',
			'border-radius:3px',
			'background:var(--background-secondary)',
			'color:var(--text-muted)',
		].join(';');
		typeBadge.setText(item.isRecurring ? '↻ Series' : '◆ Single');

		// Occurrence count (if known)
		if (item.occurrenceCount > 0) {
			const countEl = metaEl.createSpan();
			countEl.style.cssText = 'font-size:10px;color:var(--text-faint);';
			countEl.setText(`${item.occurrenceCount} occurrence${item.occurrenceCount !== 1 ? 's' : ''}`);
		}

		// "New" badge
		if (item.isNew) {
			const newBadge = metaEl.createSpan();
			newBadge.style.cssText = [
				'font-size:10px',
				'padding:1px 4px',
				'border-radius:3px',
				'background:var(--interactive-accent)',
				'color:var(--text-on-accent)',
				'font-weight:600',
			].join(';');
			newBadge.setText('New');
		}

		// Calendar name
		if (cal) {
			const calEl = metaEl.createSpan();
			calEl.style.cssText = 'font-size:10px;color:var(--text-faint);';
			calEl.setText(cal.name);
		}

		// Toggle on checkbox change
		cb.addEventListener('change', async () => {
			if (cb.checked) {
				await this.opts.callbacks.enableSeries(item.seriesKey, item.name);
				// If it was a new candidate, remove from pending list
				this.newCandidates = this.newCandidates.filter(c => c.seriesKey !== item.seriesKey);
			} else {
				await this.opts.callbacks.disableSeries(item.seriesKey);
			}
			item.enabled = cb.checked;
			item.isNew = false;
			this.renderBanner();
			this.updateSummaryCount();
		});
	}

	// ─── Summary count ───────────────────────────────────────────────────────────

	private updateSummaryCount(): void {
		const el = this.details.querySelector('.cb-subs-count') as HTMLElement | null;
		if (el) this.updateSummaryCountEl(el);
	}

	private updateSummaryCountEl(el: HTMLElement): void {
		const profiles = this.opts.callbacks.getProfiles();
		const total = Object.keys(profiles).length + this.newCandidates.filter(
			c => !profiles[c.seriesKey],
		).length;
		const enabled = Object.values(profiles).filter(p => p.enabled).length;
		const newCount = this.newCandidates.filter(c => !profiles[c.seriesKey]).length;
		let text = `${enabled} / ${total} enabled`;
		if (newCount > 0) text += ` · ${newCount} new`;
		el.setText(text);
	}

	// ─── Bulk actions ────────────────────────────────────────────────────────────

	private async enableAll(): Promise<void> {
		const profiles = this.opts.callbacks.getProfiles();
		for (const [key, profile] of Object.entries(profiles)) {
			if (!profile.enabled) {
				await this.opts.callbacks.enableSeries(key, profile.seriesName);
			}
		}
		// Also enable all new candidates
		for (const c of this.newCandidates) {
			if (!profiles[c.seriesKey]) {
				await this.opts.callbacks.enableSeries(c.seriesKey, c.title);
			}
		}
		this.newCandidates = [];
		this.renderBanner();
		this.renderList();
		this.updateSummaryCount();
	}

	private async disableAll(): Promise<void> {
		const profiles = this.opts.callbacks.getProfiles();
		for (const key of Object.keys(profiles)) {
			await this.opts.callbacks.disableSeries(key);
		}
		this.renderList();
		this.updateSummaryCount();
	}
}
