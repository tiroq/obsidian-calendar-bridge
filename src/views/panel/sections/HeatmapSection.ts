/**
 * HeatmapSection — "Activity (Last 30 days)" 7×5 grid.
 *
 * Data source: vault .md frontmatter — no API calls.
 * Color intensity: light=1, medium=3+, dark=6+
 * Hover tooltip: date, event count, filtered count
 */

import { App, TFile } from 'obsidian';

interface DayData {
	date: string;   // YYYY-MM-DD
	count: number;
	filteredCount: number;
}

function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function countIntensity(count: number): 'none' | 'light' | 'medium' | 'dark' {
	if (count === 0) return 'none';
	if (count < 3) return 'light';
	if (count < 6) return 'medium';
	return 'dark';
}

const INTENSITY_COLORS: Record<ReturnType<typeof countIntensity>, string> = {
	none: 'var(--background-modifier-border)',
	light: '#9be9a8',
	medium: '#40c463',
	dark: '#216e39',
};

export class HeatmapSection {
	private details: HTMLElement;
	private gridContainer!: HTMLElement;
	private app: App;
	private days: DayData[] = [];

	constructor(parent: HTMLElement, app: App) {
		this.app = app;

		this.details = parent.createEl('details');
		this.details.style.cssText = 'border-bottom:1px solid var(--background-modifier-border);';

		this.buildSummary();
		this.buildBody();

		// Load data when section is opened for the first time
		this.details.addEventListener('toggle', () => {
			if ((this.details as HTMLDetailsElement).open && this.days.length === 0) {
				this.loadData();
			}
		});
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

		summary.createSpan().setText('Activity (Last 30 days)');

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
		refreshBtn.setText('↻');
		refreshBtn.setAttribute('aria-label', 'Refresh heatmap');
		refreshBtn.addEventListener('click', e => {
			e.stopPropagation();
			this.loadData();
		});
	}

	private buildBody(): void {
		const body = this.details.createDiv();
		body.style.cssText = 'padding:8px 12px 12px;';

		this.gridContainer = body.createDiv({ cls: 'cb-heatmap-grid' });
		this.gridContainer.style.cssText = [
			'display:grid',
			'grid-template-columns:repeat(7, 1fr)',
			'gap:3px',
		].join(';');

		this.renderGrid();
	}

	private async loadData(): Promise<void> {
		this.days = [];

		const now = new Date();
		const dayMap = new Map<string, { count: number; filteredCount: number }>();

		// Build 30-day window
		for (let i = 29; i >= 0; i--) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			dayMap.set(formatDate(d), { count: 0, filteredCount: 0 });
		}

		// Scan vault for meeting notes with date_start frontmatter
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter;
			if (!fm || fm['type'] !== 'meeting') continue;

			const startStr = fm['date_start'] as string | undefined;
			if (!startStr) continue;

			try {
				const dateKey = startStr.slice(0, 10); // YYYY-MM-DD
				if (dayMap.has(dateKey)) {
					const entry = dayMap.get(dateKey)!;
					entry.count++;
					if (fm['status'] === 'cancelled') {
						entry.filteredCount++;
					}
				}
			} catch {
				// ignore
			}
		}

		this.days = [...dayMap.entries()].map(([date, v]) => ({
			date,
			count: v.count,
			filteredCount: v.filteredCount,
		}));

		this.renderGrid();
	}

	private renderGrid(): void {
		this.gridContainer.empty();

		if (this.days.length === 0) {
			// Show empty placeholder
			for (let i = 0; i < 35; i++) {
				const cell = this.gridContainer.createDiv();
				cell.style.cssText = [
					'height:14px',
					'border-radius:2px',
					`background:${INTENSITY_COLORS.none}`,
				].join(';');
			}
			return;
		}

		for (const day of this.days) {
			const intensity = countIntensity(day.count);
			const cell = this.gridContainer.createDiv();
			cell.style.cssText = [
				'height:14px',
				'border-radius:2px',
				`background:${INTENSITY_COLORS[intensity]}`,
				'cursor:default',
				'transition:opacity 0.1s',
			].join(';');

			const tooltip = `${day.date}\n${day.count} event${day.count !== 1 ? 's' : ''}` +
				(day.filteredCount > 0 ? `\n${day.filteredCount} filtered/cancelled` : '');
			cell.setAttribute('title', tooltip);

			cell.addEventListener('mouseenter', () => {
				cell.style.opacity = '0.7';
			});
			cell.addEventListener('mouseleave', () => {
				cell.style.opacity = '1';
			});
		}
	}

	destroy(): void {
		// nothing to clean up
	}
}
