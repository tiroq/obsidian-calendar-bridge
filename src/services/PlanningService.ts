/**
 * PlanningService — determines what action (create / update / skip) should be
 * taken for each candidate event without performing any vault writes.
 *
 * This is a pure read-only planning pass:
 *   Input  : NormalizedEvent[] + vault read access
 *   Output : SyncPlanItem[]  (action, path, reason)
 *
 * Having this separated from the write phase enables:
 *   - Preview modal (show plan before writing)
 *   - Dry-run mode
 *   - Unit testing without vault mocks
 */

import { App, TFile } from 'obsidian';
import { NormalizedEvent, PluginSettings } from '../types';
import { SyncPlanItem } from '../modals/preview-modal';
import { getNotePaths } from '../note-generator';

// ─── Planning context ─────────────────────────────────────────────────────────

export interface PlanningContext {
	/** Events that passed the filter stage and are candidates for sync. */
	events: NormalizedEvent[];
	/** Path settings needed for getNotePaths(). */
	settings: PluginSettings & { notesFolder?: string; seriesFolder?: string };
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Build a sync plan from a list of filtered events by checking vault existence.
 *
 * Pure read-only — does NOT write any files.
 *
 * @param app      Obsidian App instance (vault.getAbstractFileByPath only)
 * @param ctx      Planning context (events + path settings)
 * @returns        Array of SyncPlanItems with action and human-readable reason
 */
export function buildSyncPlan(
	app: App,
	ctx: PlanningContext,
): SyncPlanItem[] {
	const notePathMap = getNotePaths(ctx.events, ctx.settings);

	return ctx.events.map(event => {
		const path = notePathMap.get(`${event.eventId}::${event.start}`);
		if (!path) {
			return {
				action: 'skip' as const,
				path: '',
				reason: `No path resolved for event "${event.title}"`,
			};
		}

		const exists = app.vault.getAbstractFileByPath(path) instanceof TFile;
		return {
			action: (exists ? 'update' : 'create') as 'update' | 'create',
			path,
			reason: exists ? 'AUTOGEN refresh' : 'new event',
		};
	});
}
