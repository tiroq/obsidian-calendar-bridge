/**
 * SyncProgress — animated progress bar visible only during sync.
 * Auto-hides 3s after completion.
 */

import { SyncStore, SyncState } from '../stores/SyncStore';
import { SyncStage } from '../../../types';

const STAGE_LABELS: Record<SyncStage, string> = {
	'authenticating': 'Authenticating…',
	'fetching-calendars': 'Fetching calendar list…',
	'fetching-events': 'Fetching events…',
	'applying-filters': 'Applying filters…',
	'writing-notes': 'Writing notes…',
	'completed': 'Completed',
};

export class SyncProgress {
	private container: HTMLElement;
	private barFill!: HTMLElement;
	private stageLabel!: HTMLElement;
	private pctLabel!: HTMLElement;
	private unsub: () => void;
	private hideTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor(parent: HTMLElement, syncStore: SyncStore) {
		this.container = parent.createDiv({ cls: 'cb-sync-progress' });
		this.container.style.cssText = [
			'padding:8px 12px',
			'border-bottom:1px solid var(--background-modifier-border)',
			'display:none',
		].join(';');

		this.buildDOM();

		this.unsub = syncStore.subscribe(state => this.update(state));

		// Render current state immediately
		this.update(syncStore.getState());
	}

	private buildDOM(): void {
		const topRow = this.container.createDiv();
		topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';

		this.stageLabel = topRow.createSpan();
		this.stageLabel.style.cssText = 'font-size:11px;color:var(--text-muted);';

		this.pctLabel = topRow.createSpan();
		this.pctLabel.style.cssText = 'font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums;';

		// Progress bar track
		const track = this.container.createDiv();
		track.style.cssText = [
			'height:6px',
			'border-radius:3px',
			'background:var(--background-modifier-border)',
			'overflow:hidden',
		].join(';');

		this.barFill = track.createDiv();
		this.barFill.style.cssText = [
			'height:100%',
			'border-radius:3px',
			'background:var(--interactive-accent)',
			'transition:width 0.3s ease',
			'width:0%',
		].join(';');
	}

	private update(state: SyncState): void {
		if (this.hideTimeout) {
			clearTimeout(this.hideTimeout);
			this.hideTimeout = null;
		}

		if (state.isSyncing) {
			this.container.style.display = 'block';
			this.barFill.style.width = `${state.pct}%`;
			this.stageLabel.setText(state.stage ? STAGE_LABELS[state.stage] : '');
			this.pctLabel.setText(`${state.pct}%`);
		} else if (state.stage === 'completed') {
			// Show completed state briefly then hide
			this.container.style.display = 'block';
			this.barFill.style.width = '100%';
			this.stageLabel.setText('Completed ✓');
			this.pctLabel.setText('100%');
			this.hideTimeout = setTimeout(() => {
				this.container.style.display = 'none';
			}, 3000);
		} else {
			this.container.style.display = 'none';
		}
	}

	destroy(): void {
		this.unsub();
		if (this.hideTimeout) clearTimeout(this.hideTimeout);
	}
}
