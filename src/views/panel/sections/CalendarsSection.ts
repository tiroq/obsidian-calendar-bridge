/**
 * CalendarsSection — collapsible calendar list with checkboxes, color dots,
 * metadata rows, and refresh / select-all / select-none / search controls.
 *
 * Sort order: Primary → Owner → Writer → Reader → freeBusyReader
 */

import { RichCalendarItem, GoogleApiSettings } from '../../../types';
import { CalendarStore } from '../stores/CalendarStore';

const ROLE_ORDER: Record<string, number> = {
	owner: 1,
	writer: 2,
	reader: 3,
	freeBusyReader: 4,
};

const ROLE_LABELS: Record<string, string> = {
	owner: 'Owner',
	writer: 'Writer',
	reader: 'Reader',
	freeBusyReader: 'Free/Busy',
};

export interface CalendarsSectionOptions {
	calendarStore: CalendarStore;
	gcalSettings: GoogleApiSettings;
	onSelectionChange: (selectedIds: string[]) => Promise<void>;
}

export class CalendarsSection {
	private details: HTMLElement;
	private listContainer!: HTMLElement;
	private searchInput!: HTMLInputElement;
	private opts: CalendarsSectionOptions;
	private calendars: RichCalendarItem[] = [];
	private searchQuery = '';
	private unsub: () => void;

	constructor(parent: HTMLElement, opts: CalendarsSectionOptions) {
		this.opts = opts;
		this.calendars = opts.calendarStore.getCalendars();

		this.details = parent.createEl('details');
		this.details.style.cssText = 'border-bottom:1px solid var(--background-modifier-border);';

		this.buildSummary();
		this.buildBody();

		this.unsub = opts.calendarStore.subscribe(cals => {
			this.calendars = cals;
			this.renderList();
			this.updateSummaryCount();
		});
	}

	private selectedIds(): string[] {
		return this.opts.gcalSettings.selectedCalendarIds ?? [];
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
		summary.setAttribute('data-cb-summary', 'calendars');

		const left = summary.createSpan();
		left.setText('Calendars');

		const right = summary.createSpan({ cls: 'cb-calendars-count' });
		right.style.cssText = 'font-size:11px;color:var(--text-muted);font-weight:400;';
		this.updateSummaryCountEl(right);
	}

	private updateSummaryCount(): void {
		const el = this.details.querySelector('.cb-calendars-count') as HTMLElement | null;
		if (el) this.updateSummaryCountEl(el);
	}

	private updateSummaryCountEl(el: HTMLElement): void {
		const sel = this.selectedIds();
		el.setText(`${sel.length} / ${this.calendars.length} selected`);
	}

	private buildBody(): void {
		const body = this.details.createDiv();
		body.style.cssText = 'padding:6px 12px 10px;';

		// ── Controls row ────────────────────────────────────────────────────────
		const controls = body.createDiv();
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

		const refreshBtn = controls.createEl('button');
		refreshBtn.style.cssText = btnStyle;
		refreshBtn.setText('↻ Refresh');
		refreshBtn.addEventListener('click', () => this.opts.calendarStore.refresh());

		const allBtn = controls.createEl('button');
		allBtn.style.cssText = btnStyle;
		allBtn.setText('Select all');
		allBtn.addEventListener('click', () => this.selectAll());

		const noneBtn = controls.createEl('button');
		noneBtn.style.cssText = btnStyle;
		noneBtn.setText('Select none');
		noneBtn.addEventListener('click', () => this.selectNone());

		// Search
		this.searchInput = controls.createEl('input');
		this.searchInput.type = 'text';
		this.searchInput.placeholder = 'Search…';
		this.searchInput.style.cssText = [
			'flex:1',
			'min-width:80px',
			'font-size:11px',
			'padding:2px 6px',
			'border-radius:3px',
			'border:1px solid var(--background-modifier-border)',
			'background:var(--background-primary)',
			'color:var(--text-normal)',
		].join(';');
		this.searchInput.addEventListener('input', () => {
			this.searchQuery = this.searchInput.value.toLowerCase();
			this.renderList();
		});

		// ── List ────────────────────────────────────────────────────────────────
		this.listContainer = body.createDiv({ cls: 'cb-calendars-list' });
		this.renderList();
	}

	private renderList(): void {
		this.listContainer.empty();

		const filtered = this.calendars
			.filter(c => !this.searchQuery || c.name.toLowerCase().includes(this.searchQuery))
			.sort((a, b) => {
				// Primary first
				if (a.primary && !b.primary) return -1;
				if (!a.primary && b.primary) return 1;
				const ra = ROLE_ORDER[a.accessRole ?? 'reader'] ?? 99;
				const rb = ROLE_ORDER[b.accessRole ?? 'reader'] ?? 99;
				if (ra !== rb) return ra - rb;
				return a.name.localeCompare(b.name);
			});

		if (filtered.length === 0) {
			const empty = this.listContainer.createDiv();
			empty.style.cssText = 'font-size:11px;color:var(--text-faint);padding:4px 0;';
			empty.setText(this.calendars.length === 0 ? 'No calendars. Click Refresh.' : 'No match.');
			return;
		}

		const selected = new Set(this.selectedIds());

		for (const cal of filtered) {
			const row = this.listContainer.createDiv({ cls: 'cb-calendar-row' });
			row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:5px 0;';

			// Checkbox
			const cb = row.createEl('input');
			cb.type = 'checkbox';
			cb.checked = selected.has(cal.id);
			cb.style.cssText = 'flex-shrink:0;margin-top:2px;cursor:pointer;';
			const isReadOnly = cal.accessRole === 'freeBusyReader';
			if (isReadOnly) {
				cb.disabled = true;
				cb.title = 'Insufficient permission';
			}

			// Color dot
			const dot = row.createSpan();
			dot.style.cssText = [
				'width:10px',
				'height:10px',
				'border-radius:50%',
				'flex-shrink:0',
				'margin-top:3px',
				`background:${cal.backgroundColor ?? 'var(--interactive-accent)'}`,
			].join(';');

			// Text block
			const textBlock = row.createDiv();
			textBlock.style.cssText = 'flex:1;min-width:0;';

			const nameEl = textBlock.createDiv();
			nameEl.style.cssText = 'font-size:12px;font-weight:600;color:var(--text-normal);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
			nameEl.setText(cal.name + (cal.primary ? ' ★' : ''));

			const metaEl = textBlock.createDiv();
			metaEl.style.cssText = 'display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px;';

			if (cal.accessRole) {
				const badge = metaEl.createSpan();
				badge.style.cssText = [
					'font-size:10px',
					'padding:1px 4px',
					'border-radius:3px',
					'background:var(--background-secondary)',
					'color:var(--text-muted)',
				].join(';');
				badge.setText(ROLE_LABELS[cal.accessRole] ?? cal.accessRole);
			}

			if (cal.timeZone) {
				const tz = metaEl.createSpan();
				tz.style.cssText = 'font-size:10px;color:var(--text-faint);';
				tz.setText(cal.timeZone);
			}

			// Toggle selection on checkbox change
			cb.addEventListener('change', async () => {
				const cur = new Set(this.selectedIds());
				if (cb.checked) cur.add(cal.id);
				else cur.delete(cal.id);
				this.opts.gcalSettings.selectedCalendarIds = [...cur];
				await this.opts.onSelectionChange([...cur]);
				this.updateSummaryCount();
			});
		}
	}

	private async selectAll(): Promise<void> {
		const ids = this.calendars.map(c => c.id);
		this.opts.gcalSettings.selectedCalendarIds = ids;
		await this.opts.onSelectionChange(ids);
		this.renderList();
		this.updateSummaryCount();
	}

	private async selectNone(): Promise<void> {
		this.opts.gcalSettings.selectedCalendarIds = [];
		await this.opts.onSelectionChange([]);
		this.renderList();
		this.updateSummaryCount();
	}


	/** Expand the section (open the details element). */
	expand(): void {
		(this.details as HTMLDetailsElement).open = true;
	}

	/** Scroll the section into view. */
	scrollIntoView(): void {
		this.details.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	destroy(): void {
		this.unsub();
	}
}
