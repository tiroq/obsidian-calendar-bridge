/**
 * FiltersSection — collapsible panel with all 11 filter fields.
 *
 * Sections:
 *   7.1 Sync Window: horizon days, include past events
 *   7.2 Event Type: all-day, declined, only-with-attendees, skip-shorter-than
 *   7.3 Content: conference links (Meet/Zoom/Teams toggles), attendees, location
 *   7.4 Advanced (nested collapsible): exclude/include title filters + regex mode
 */

import { FilterStore } from '../stores/FilterStore';

export class FiltersSection {
	private details: HTMLElement;
	private badgeEl!: HTMLElement;
	private filterStore: FilterStore;
	private unsub: () => void;

	constructor(parent: HTMLElement, filterStore: FilterStore) {
		this.filterStore = filterStore;

		this.details = parent.createEl('details');
		this.details.style.cssText = 'border-bottom:1px solid var(--background-modifier-border);';

		this.buildSummary();
		this.buildBody();

		this.unsub = filterStore.subscribe(() => this.updateBadge());
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

		summary.createSpan().setText('Filters');

		this.badgeEl = summary.createSpan();
		this.badgeEl.style.cssText = 'font-size:11px;color:var(--text-muted);font-weight:400;';
		this.updateBadge();
	}

	private updateBadge(): void {
		const count = this.filterStore.activeFilterCount();
		this.badgeEl.setText(count > 0 ? `(${count} active)` : '');
	}

	private buildBody(): void {
		const body = this.details.createDiv();
		body.style.cssText = 'padding:6px 12px 10px;display:flex;flex-direction:column;gap:12px;';

		const s = this.filterStore.getState();

		// ── 7.1 Sync Window ─────────────────────────────────────────────────────
		const win = this.addGroup(body, 'Sync Window');

		this.addNumberField(win, 'Horizon (days)', s.panelHorizonDays, 1, 365, async val => {
			await this.filterStore.update({ panelHorizonDays: val });
		});

		// ── 7.2 Event Type Filters ──────────────────────────────────────────────
		const types = this.addGroup(body, 'Event Types');

		this.addCheckbox(types, 'Include all-day events', s.panelIncludeAllDay, async v => {
			await this.filterStore.update({ panelIncludeAllDay: v });
		});
		this.addCheckbox(types, 'Include declined events', s.panelIncludeDeclined, async v => {
			await this.filterStore.update({ panelIncludeDeclined: v });
		});
		this.addCheckbox(types, 'Only events with attendees', s.panelOnlyWithAttendees, async v => {
			await this.filterStore.update({ panelOnlyWithAttendees: v });
		});

		this.addNumberField(types, 'Skip shorter than (min)', s.panelSkipShorterThanMin, 0, 1440, async val => {
			await this.filterStore.update({ panelSkipShorterThanMin: val });
		}, '0 = disabled');

		// ── 7.3 Content Extraction ──────────────────────────────────────────────
		const content = this.addGroup(body, 'Content Extraction');

		this.addCheckbox(content, 'Conference links (Meet / Zoom / Teams)', s.panelExtractConferenceLinks, async v => {
			await this.filterStore.update({ panelExtractConferenceLinks: v });
		});
		this.addCheckbox(content, 'Attendees', s.panelExtractAttendees, async v => {
			await this.filterStore.update({ panelExtractAttendees: v });
		});
		this.addCheckbox(content, 'Location', s.panelExtractLocation, async v => {
			await this.filterStore.update({ panelExtractLocation: v });
		});

		// ── 7.4 Advanced (nested collapsible) ───────────────────────────────────
		const advDetails = body.createEl('details');
		advDetails.style.cssText = 'border:1px solid var(--background-modifier-border);border-radius:4px;';

		const advSummary = advDetails.createEl('summary');
		advSummary.style.cssText = [
			'padding:5px 8px',
			'cursor:pointer',
			'user-select:none',
			'font-size:11px',
			'font-weight:600',
			'color:var(--text-muted)',
			'list-style:none',
		].join(';');
		advSummary.setText('Advanced');

		const advBody = advDetails.createDiv();
		advBody.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:10px;';

		this.addTextareaField(advBody, 'Exclude titles containing', s.panelExcludeTitles, 'Comma-separated keywords', async v => {
			await this.filterStore.update({ panelExcludeTitles: v });
		});
		this.addTextareaField(advBody, 'Include only titles containing', s.panelIncludeTitles, 'Comma-separated keywords', async v => {
			await this.filterStore.update({ panelIncludeTitles: v });
		});
		this.addCheckbox(advBody, 'Regex mode', s.panelTitleRegexMode, async v => {
			await this.filterStore.update({ panelTitleRegexMode: v });
		});

		// Reset all link
		const resetRow = body.createDiv();
		resetRow.style.cssText = 'display:flex;justify-content:flex-end;';
		const resetBtn = resetRow.createEl('button');
		resetBtn.style.cssText = [
			'font-size:11px',
			'padding:2px 7px',
			'border-radius:3px',
			'border:1px solid var(--background-modifier-border)',
			'background:none',
			'cursor:pointer',
			'color:var(--text-muted)',
		].join(';');
		resetBtn.setText('Reset to defaults');
		resetBtn.addEventListener('click', () => this.filterStore.reset());
	}

	// ── Helpers ──────────────────────────────────────────────────────────────────

	private addGroup(parent: HTMLElement, label: string): HTMLElement {
		const group = parent.createDiv();
		const header = group.createDiv();
		header.style.cssText = 'font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;';
		header.setText(label);
		const fields = group.createDiv();
		fields.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
		return fields;
	}

	private addCheckbox(parent: HTMLElement, label: string, checked: boolean, onChange: (v: boolean) => Promise<void>): void {
		const row = parent.createDiv();
		row.style.cssText = 'display:flex;align-items:center;gap:8px;';

		const cb = row.createEl('input');
		cb.type = 'checkbox';
		cb.checked = checked;
		cb.style.cssText = 'cursor:pointer;';

		const lbl = row.createEl('label');
		lbl.style.cssText = 'font-size:12px;color:var(--text-normal);cursor:pointer;';
		lbl.setText(label);
		lbl.addEventListener('click', () => cb.click());

		cb.addEventListener('change', () => onChange(cb.checked));
	}

	private addNumberField(parent: HTMLElement, label: string, value: number, min: number, max: number, onChange: (v: number) => Promise<void>, hint?: string): void {
		const row = parent.createDiv();
		row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

		const lbl = row.createEl('label');
		lbl.style.cssText = 'font-size:12px;color:var(--text-normal);flex:1;';
		lbl.setText(label);

		const input = row.createEl('input');
		input.type = 'number';
		input.value = String(value);
		input.min = String(min);
		input.max = String(max);
		input.style.cssText = 'width:60px;font-size:12px;padding:2px 5px;border-radius:3px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);';

		if (hint) {
			const hintEl = row.createSpan();
			hintEl.style.cssText = 'font-size:10px;color:var(--text-faint);';
			hintEl.setText(hint);
		}

		input.addEventListener('change', () => {
			const v = parseInt(input.value, 10);
			if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
		});
	}

	private addTextareaField(parent: HTMLElement, label: string, value: string, placeholder: string, onChange: (v: string) => Promise<void>): void {
		const block = parent.createDiv();

		const lbl = block.createEl('label');
		lbl.style.cssText = 'font-size:12px;color:var(--text-normal);display:block;margin-bottom:4px;';
		lbl.setText(label);

		const input = block.createEl('input');
		input.type = 'text';
		input.value = value;
		input.placeholder = placeholder;
		input.style.cssText = 'width:100%;box-sizing:border-box;font-size:11px;padding:3px 6px;border-radius:3px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);';

		input.addEventListener('change', () => onChange(input.value.trim()));
	}

	destroy(): void {
		this.unsub();
	}
}
