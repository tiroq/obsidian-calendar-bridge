/**
 * PreviewSection — collapsible list of the next 5 upcoming events
 * with sync/filter status indicators.
 *
 * Icons:
 *   🟢 will sync (passes filters)
 *   ⚪ filtered (excluded by current filter settings)
 *   🔵 all-day event
 */

import { NormalizedEvent } from '../../../types';
import { FilterStore } from '../stores/FilterStore';

export interface PreviewSectionOptions {
	filterStore: FilterStore;
	/** Fetch upcoming events for preview (called on Refresh). */
	fetchEvents: () => Promise<NormalizedEvent[]>;
}

function formatEventTime(event: NormalizedEvent): string {
	if (event.isAllDay) return event.start.slice(0, 10);
	try {
		const d = new Date(event.start);
		return d.toLocaleString(undefined, {
			month: 'short', day: 'numeric',
			hour: '2-digit', minute: '2-digit',
		});
	} catch {
		return event.start;
	}
}

function applyFilters(event: NormalizedEvent, filters: ReturnType<FilterStore['getState']>): string | null {
	// Returns null if passes, or a reason string if excluded

	if (!filters.panelIncludeAllDay && event.isAllDay) {
		return 'All-day excluded';
	}

	if (!filters.panelIncludeDeclined && event.attendees) {
		const selfDeclined = event.attendees.some(a => a.responseStatus === 'declined');
		if (selfDeclined) return 'Declined';
	}

	if (filters.panelOnlyWithAttendees && (!event.attendees || event.attendees.length === 0)) {
		return 'No attendees';
	}

	if (filters.panelSkipShorterThanMin > 0 && !event.isAllDay) {
		const durationMs = event.endDate.getTime() - event.startDate.getTime();
		const durationMin = durationMs / 60000;
		if (durationMin < filters.panelSkipShorterThanMin) {
			return `< ${filters.panelSkipShorterThanMin} min`;
		}
	}

	if (filters.panelExcludeTitles) {
		const keywords = filters.panelTitleRegexMode
			? [filters.panelExcludeTitles]
			: filters.panelExcludeTitles.split(',').map(k => k.trim()).filter(Boolean);
		for (const kw of keywords) {
			try {
				const re = filters.panelTitleRegexMode ? new RegExp(kw, 'i') : null;
				if (re ? re.test(event.title) : event.title.toLowerCase().includes(kw.toLowerCase())) {
					return `Excluded: "${kw}"`;
				}
			} catch {
				// Invalid regex — skip
			}
		}
	}

	if (filters.panelIncludeTitles) {
		const keywords = filters.panelTitleRegexMode
			? [filters.panelIncludeTitles]
			: filters.panelIncludeTitles.split(',').map(k => k.trim()).filter(Boolean);
		const matches = keywords.some(kw => {
			try {
				const re = filters.panelTitleRegexMode ? new RegExp(kw, 'i') : null;
				return re ? re.test(event.title) : event.title.toLowerCase().includes(kw.toLowerCase());
			} catch {
				return false;
			}
		});
		if (!matches) return 'Title not in include list';
	}

	return null;
}

export class PreviewSection {
	private details: HTMLElement;
	private listContainer!: HTMLElement;
	private opts: PreviewSectionOptions;
	private events: NormalizedEvent[] = [];
	/** Full unsliced event list for diagnostics. */
	private _allFetched: NormalizedEvent[] = [];
	private isLoading = false;
	private unsub: () => void;

	constructor(parent: HTMLElement, opts: PreviewSectionOptions) {
		this.opts = opts;

		this.details = parent.createEl('details');
		this.details.style.cssText = 'border-bottom:1px solid var(--background-modifier-border);';

		this.buildSummary();
		this.buildBody();

		// Re-render when filters change
		this.unsub = opts.filterStore.subscribe(() => { this.renderList(); if (this._allFetched.length > 0) this.renderDiagnostics(this._allFetched, opts.filterStore.getState()); });
	}

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

		summary.createSpan().setText('Preview (Next 5 events)');

		const refreshBtn = summary.createEl('button');
		refreshBtn.style.cssText = [
			'font-size:11px',
			'padding:2px 7px',
			'border-radius:3px',
			'border:1px solid var(--background-modifier-border)',
			'background:var(--background-secondary)',
			'cursor:pointer',
			'color:var(--text-muted)',
		].join(';');
		refreshBtn.setText('↻ Refresh');
		refreshBtn.addEventListener('click', e => {
			e.stopPropagation();
			this.load();
		});
	}

	private buildBody(): void {
		const body = this.details.createDiv();
		body.style.cssText = 'padding:4px 12px 10px;';
		this.listContainer = body.createDiv();
		this.renderList();
	}

	private async load(): Promise<void> {
		if (this.isLoading) return;
		this.isLoading = true;
		this.listContainer.empty();
		const loadingEl = this.listContainer.createDiv();
		loadingEl.style.cssText = 'font-size:11px;color:var(--text-faint);padding:6px 0;';
		loadingEl.setText('Loading…');

		try {
		const allFetched = await this.opts.fetchEvents();
		this._allFetched = allFetched;
		// Sort by start ascending, take first 5 for display
		this.events = allFetched
			.filter(e => e.startDate >= new Date())
			.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
			.slice(0, 5);

		} catch (err) {
			this.listContainer.empty();
			const errEl = this.listContainer.createDiv();
			errEl.style.cssText = 'font-size:11px;color:var(--color-red);padding:4px 0;';
			errEl.setText(`Error: ${(err as Error).message}`);
			return;
		} finally {
			this.isLoading = false;
		}

		this.renderList();
		this.renderDiagnostics(this._allFetched, this.opts.filterStore.getState());
	}

	/** Render diagnostics block below the event list. */
	private renderDiagnostics(all: NormalizedEvent[], filters: ReturnType<FilterStore['getState']>): void {
		this.listContainer.querySelector('.cb-diagnostics')?.remove();
		if (all.length === 0 && this._allFetched.length === 0) return;

		const diag = this.listContainer.createDiv();
		diag.className = 'cb-diagnostics';
		diag.style.cssText = [
			'margin-top:8px',
			'padding:6px 8px',
			'border-radius:4px',
			'background:var(--background-secondary)',
			'font-size:10px',
			'color:var(--text-muted)',
			'line-height:1.6',
		].join(';');

		const included = all.filter(e => applyFilters(e, filters) === null);
		const exclusions: Record<string, number> = {};
		for (const e of all) {
			const r = applyFilters(e, filters);
			if (r) exclusions[r] = (exclusions[r] ?? 0) + 1;
		}

		const lines: string[] = [];
		lines.push(`📋 Fetched: ${all.length} event(s)`);
		lines.push(`✅ Included: ${included.length}`);
		for (const [reason, count] of Object.entries(exclusions)) {
			lines.push(`❌ ${reason}: ${count}`);
		}

		if (all.length > 0 && included.length === 0) {
			lines.push('');
			lines.push('⚠️ All events filtered out. Adjust filters or check calendar selection.');
		} else if (all.length === 0) {
			lines.push('');
			lines.push('⚠️ No events fetched. Check: calendar selected, sync horizon, and OAuth connection.');
		}

		diag.innerHTML = lines
			.map(l => l === '' ? '<br>' : `<div>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`)
			.join('');
	}

	private renderList(): void {
		this.listContainer.empty();

		if (this.events.length === 0) {
			const empty = this.listContainer.createDiv();
			empty.style.cssText = 'font-size:11px;color:var(--text-faint);padding:6px 0;';
			empty.setText('Click Refresh to load preview.');
			return;
		}

		const filters = this.opts.filterStore.getState();

		for (const event of this.events) {
			const reason = applyFilters(event, filters);
			const filtered = reason !== null;

			const row = this.listContainer.createDiv();
			row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid var(--background-modifier-border-focus);';

			// Icon
			const icon = row.createSpan();
			icon.style.cssText = 'flex-shrink:0;font-size:12px;margin-top:1px;';
			if (filtered) {
				icon.setText('⚪');
				icon.setAttribute('title', reason ?? '');
			} else if (event.isAllDay) {
				icon.setText('🔵');
			} else {
				icon.setText('🟢');
			}

			const info = row.createDiv();
			info.style.cssText = 'flex:1;min-width:0;';

			const timeEl = info.createSpan();
			timeEl.style.cssText = 'font-size:10px;color:var(--text-faint);display:block;';
			timeEl.setText(formatEventTime(event));

			const titleEl = info.createDiv();
			titleEl.style.cssText = [
				'font-size:12px',
				'font-weight:600',
				`color:${filtered ? 'var(--text-muted)' : 'var(--text-normal)'}`,
				'white-space:nowrap',
				'overflow:hidden',
				'text-overflow:ellipsis',
			].join(';');
			titleEl.setText(event.title);

			const calEl = info.createSpan();
			calEl.style.cssText = 'font-size:10px;color:var(--text-faint);';
			calEl.setText(event.sourceName);

			if (filtered && reason) {
				const reasonEl = info.createSpan();
				reasonEl.style.cssText = 'font-size:10px;color:var(--text-faint);margin-left:4px;';
				reasonEl.setText(`— ${reason}`);
			}
		}
	}

	destroy(): void {
		this.unsub();
	}
}
