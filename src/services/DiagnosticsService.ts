/**
 * DiagnosticsService — stores the last N sync reports in memory and
 * converts a SyncResult into a SyncReport.
 *
 * Used by:
 *   - main.ts (call recordSyncResult after every runSync)
 *   - DebugSection (reads getReports())
 */

import { SyncReport, SyncReportEntry } from '../types';
import { SyncResult } from '../sync-manager';

const MAX_REPORTS = 10;

export class DiagnosticsService {
	private reports: SyncReport[] = [];

	/**
	 * Convert a SyncResult to a SyncReport and store it.
	 * Returns the stored report.
	 */
	recordSyncResult(result: SyncResult, startedAt: Date): SyncReport {
		const finishedAt = new Date();
		const entries: SyncReportEntry[] = [
			{ stage: 'Fetched', count: result.eventsFetched },
			{ stage: 'Eligible', count: result.eventsEligible },
			{ stage: 'Planned', count: result.notesPlanned },
			{ stage: 'Created', count: result.created },
			{ stage: 'Updated', count: result.updated },
			{ stage: 'Skipped', count: result.skipped },
		];
		if (result.errors.length > 0) {
			entries.push({ stage: 'Errors', count: result.errors.length, detail: result.errors[0] });
		}
		if (result.newCandidates && result.newCandidates.length > 0) {
			entries.push({ stage: 'New series candidates', count: result.newCandidates.length });
		}

		const report: SyncReport = {
			startedAt: startedAt.toISOString(),
			finishedAt: finishedAt.toISOString(),
			durationMs: finishedAt.getTime() - startedAt.getTime(),
			eventsFetched: result.eventsFetched,
			eventsEligible: result.eventsEligible,
			notesPlanned: result.notesPlanned,
			notesCreated: result.created,
			notesUpdated: result.updated,
			notesSkipped: result.skipped,
			errors: result.errors,
			zeroReason: result.zeroReason,
			entries,
		};

		this.reports.unshift(report);
		if (this.reports.length > MAX_REPORTS) {
			this.reports.length = MAX_REPORTS;
		}
		return report;
	}

	/** Get stored reports (most recent first). */
	getReports(): SyncReport[] {
		return [...this.reports];
	}

	/** Latest report, or null if no sync has run yet. */
	getLatest(): SyncReport | null {
		return this.reports[0] ?? null;
	}

	/** Clear all stored reports. */
	clear(): void {
		this.reports = [];
	}
}
