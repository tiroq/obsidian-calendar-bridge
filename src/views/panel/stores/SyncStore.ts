/**
 * SyncStore — tracks live sync state (isSyncing, stage, pct, times).
 * Exposes triggerSync() which calls plugin.triggerSync() with the onProgress hook.
 */

import { SyncStage } from '../../../types';

export interface SyncState {
	isSyncing: boolean;
	stage: SyncStage | null;
	pct: number;
	lastSyncTime: string | null;
}

export type SyncStoreListener = (state: SyncState) => void;

export class SyncStore {
	private state: SyncState = {
		isSyncing: false,
		stage: null,
		pct: 0,
		lastSyncTime: null,
	};

	private listeners: Set<SyncStoreListener> = new Set();
	private triggerSyncFn: (onProgress: (stage: SyncStage, pct: number) => void) => Promise<void>;

	constructor(
		triggerSyncFn: (onProgress: (stage: SyncStage, pct: number) => void) => Promise<void>,
		initialLastSyncTime?: string,
	) {
		this.triggerSyncFn = triggerSyncFn;
		this.state.lastSyncTime = initialLastSyncTime ?? null;
	}

	getState(): SyncState {
		return { ...this.state };
	}

	subscribe(listener: SyncStoreListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async triggerSync(): Promise<void> {
		if (this.state.isSyncing) return;
		this.setState({ isSyncing: true, stage: 'authenticating', pct: 0 });

		try {
			await this.triggerSyncFn((stage, pct) => {
				this.setState({ stage, pct });
			});
		} finally {
			this.setState({
				isSyncing: false,
				stage: 'completed',
				pct: 100,
				lastSyncTime: new Date().toLocaleString(),
			});
		}
	}

	private setState(partial: Partial<SyncState>): void {
		this.state = { ...this.state, ...partial };
		for (const fn of this.listeners) {
			fn(this.getState());
		}
	}
}
