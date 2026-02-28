/**
 * DebugSection — collapsible diagnostics panel for Calendar Bridge.
 *
 * Shows the last sync report:
 *   • Sync timestamp + duration
 *   • Pipeline stage counters (Fetched → Eligible → Planned → Created/Updated/Skipped)
 *   • Zero-reason message when nothing was written
 *   • Errors (if any)
 *
 * Refreshed on demand (Refresh button) or after each sync via update().
 */

import { SyncReport } from '../../../types';

export class DebugSection {
	private details: HTMLElement;
	private body: HTMLElement;
	private report: SyncReport | null;
	private getReport: () => SyncReport | null;

	constructor(parent: HTMLElement, getReport: () => SyncReport | null) {
		this.getReport = getReport;
		this.report = getReport();

		this.details = parent.createEl('details');
		this.details.style.cssText = 'border-bottom:1px solid var(--background-modifier-border);';

		this.buildSummary();
		this.body = this.details.createDiv();
		this.body.style.cssText = 'padding:4px 12px 10px;';
		this.render();
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

		summary.createSpan().setText('Debug / Diagnostics');

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
			this.report = this.getReport();
			this.render();
		});
	}

	/** Update with a new report (called externally after sync completes). */
	update(report: SyncReport | null): void {
		this.report = report;
		this.render();
	}

	private render(): void {
		this.body.empty();

		if (!this.report) {
			const empty = this.body.createDiv();
			empty.style.cssText = 'font-size:11px;color:var(--text-faint);padding:6px 0;';
			empty.setText('No sync has run yet. Click Sync Now in the header.');
			return;
		}

		const r = this.report;

		// ── Timestamp + duration ───────────────────────────────────────────────
		const metaEl = this.body.createDiv();
		metaEl.style.cssText = 'font-size:10px;color:var(--text-faint);margin-bottom:8px;';
		const start = new Date(r.startedAt);
		metaEl.setText(
			`Last sync: ${start.toLocaleString()} · ${r.durationMs}ms`,
		);

		// ── Pipeline counters ─────────────────────────────────────────────────
		const stages: Array<{ label: string; value: number; highlight?: boolean }> = [
			{ label: 'Fetched', value: r.eventsFetched },
			{ label: 'Eligible', value: r.eventsEligible },
			{ label: 'Planned', value: r.notesPlanned },
			{ label: 'Created', value: r.notesCreated, highlight: r.notesCreated > 0 },
			{ label: 'Updated', value: r.notesUpdated, highlight: r.notesUpdated > 0 },
			{ label: 'Skipped', value: r.notesSkipped },
		];

		const grid = this.body.createDiv();
		grid.style.cssText = [
			'display:grid',
			'grid-template-columns:repeat(3,1fr)',
			'gap:4px',
			'margin-bottom:8px',
		].join(';');

		for (const stage of stages) {
			const cell = grid.createDiv();
			cell.style.cssText = [
				'padding:4px 6px',
				'border-radius:4px',
				'background:var(--background-secondary)',
				'text-align:center',
			].join(';');

			const val = cell.createDiv();
			val.style.cssText = [
				'font-size:14px',
				'font-weight:700',
				stage.highlight ? 'color:var(--color-green)' : 'color:var(--text-normal)',
			].join(';');
			val.setText(String(stage.value));

			const lbl = cell.createDiv();
			lbl.style.cssText = 'font-size:10px;color:var(--text-faint);';
			lbl.setText(stage.label);
		}

		// ── Zero-reason ───────────────────────────────────────────────────────
		if (r.zeroReason && r.notesCreated === 0 && r.notesUpdated === 0) {
			const zeroEl = this.body.createDiv();
			zeroEl.style.cssText = [
				'font-size:11px',
				'color:var(--color-orange)',
				'background:var(--background-secondary)',
				'border-radius:4px',
				'padding:5px 8px',
				'margin-bottom:6px',
			].join(';');
			zeroEl.setText(`⚠ ${r.zeroReason}`);
		}

		// ── Errors ────────────────────────────────────────────────────────────
		if (r.errors.length > 0) {
			const errHeader = this.body.createDiv();
			errHeader.style.cssText = 'font-size:11px;font-weight:600;color:var(--color-red);margin-bottom:3px;';
			errHeader.setText(`⛔ ${r.errors.length} error(s)`);

			for (const err of r.errors) {
				const errEl = this.body.createDiv();
				errEl.style.cssText = [
					'font-size:10px',
					'color:var(--text-muted)',
					'padding:2px 0 2px 8px',
					'border-left:2px solid var(--color-red)',
					'margin-bottom:2px',
					'word-break:break-all',
				].join(';');
				errEl.setText(err);
			}
		}
	}

	destroy(): void {
		// nothing to clean up
	}
}
