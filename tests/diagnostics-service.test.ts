import { DiagnosticsService } from '../src/services/DiagnosticsService';
import { SyncResult } from '../src/sync-manager';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
	return {
		created: 2,
		updated: 1,
		skipped: 3,
		errors: [],
		eventsFetched: 10,
		eventsEligible: 6,
		notesPlanned: 3,
		normalizedEvents: [],
		newCandidates: [],
		zeroReason: undefined,
		...overrides,
	};
}

// ─── DiagnosticsService ────────────────────────────────────────────────────────

describe('DiagnosticsService', () => {
	let svc: DiagnosticsService;

	beforeEach(() => {
		svc = new DiagnosticsService();
	});

	describe('initial state', () => {
		it('getLatest returns null when no sync has run', () => {
			expect(svc.getLatest()).toBeNull();
		});

		it('getReports returns empty array when no sync has run', () => {
			expect(svc.getReports()).toEqual([]);
		});
	});

	describe('recordSyncResult', () => {
		it('stores a report and returns it', () => {
			const result = makeSyncResult();
			const startedAt = new Date('2026-03-01T10:00:00Z');
			const report = svc.recordSyncResult(result, startedAt);

			expect(report).toBeDefined();
			expect(report.eventsFetched).toBe(10);
			expect(report.eventsEligible).toBe(6);
			expect(report.notesPlanned).toBe(3);
			expect(report.notesCreated).toBe(2);
			expect(report.notesUpdated).toBe(1);
			expect(report.notesSkipped).toBe(3);
		});

		it('sets startedAt and finishedAt as ISO strings', () => {
			const startedAt = new Date();
			const report = svc.recordSyncResult(makeSyncResult(), startedAt);

			expect(report.startedAt).toBe(startedAt.toISOString());
			expect(typeof report.finishedAt).toBe('string');
			expect(new Date(report.finishedAt).getTime()).toBeGreaterThanOrEqual(startedAt.getTime());
		});

		it('computes durationMs >= 0', () => {
			const report = svc.recordSyncResult(makeSyncResult(), new Date());
			expect(report.durationMs).toBeGreaterThanOrEqual(0);
		});

		it('passes through zeroReason when present', () => {
			const result = makeSyncResult({ zeroReason: 'No eligible events' });
			const report = svc.recordSyncResult(result, new Date());
			expect(report.zeroReason).toBe('No eligible events');
		});

		it('passes through errors array', () => {
			const result = makeSyncResult({ errors: ['Failed to fetch calendar X'] });
			const report = svc.recordSyncResult(result, new Date());
			expect(report.errors).toEqual(['Failed to fetch calendar X']);
		});

		it('includes standard pipeline entries', () => {
			const report = svc.recordSyncResult(makeSyncResult(), new Date());
			const stageNames = report.entries.map(e => e.stage);

			expect(stageNames).toContain('Fetched');
			expect(stageNames).toContain('Eligible');
			expect(stageNames).toContain('Planned');
			expect(stageNames).toContain('Created');
			expect(stageNames).toContain('Updated');
			expect(stageNames).toContain('Skipped');
		});

		it('adds Errors entry when result has errors', () => {
			const result = makeSyncResult({ errors: ['oops'] });
			const report = svc.recordSyncResult(result, new Date());
			const errEntry = report.entries.find(e => e.stage === 'Errors');

			expect(errEntry).toBeDefined();
			expect(errEntry!.count).toBe(1);
			expect(errEntry!.detail).toBe('oops');
		});

		it('does not add Errors entry when no errors', () => {
			const report = svc.recordSyncResult(makeSyncResult({ errors: [] }), new Date());
			const errEntry = report.entries.find(e => e.stage === 'Errors');
			expect(errEntry).toBeUndefined();
		});

		it('adds new-series-candidates entry when candidates exist', () => {
			const candidates = [{ eventId: 'x', title: 'Standup', isRecurring: true } as any];
			const result = makeSyncResult({ newCandidates: candidates });
			const report = svc.recordSyncResult(result, new Date());
			const candidateEntry = report.entries.find(e => e.stage === 'New series candidates');

			expect(candidateEntry).toBeDefined();
			expect(candidateEntry!.count).toBe(1);
		});

		it('does not add candidates entry when newCandidates is empty', () => {
			const report = svc.recordSyncResult(makeSyncResult({ newCandidates: [] }), new Date());
			const candidateEntry = report.entries.find(e => e.stage === 'New series candidates');
			expect(candidateEntry).toBeUndefined();
		});
	});

	describe('getLatest', () => {
		it('returns the most recently recorded report', () => {
			svc.recordSyncResult(makeSyncResult({ created: 1 }), new Date());
			svc.recordSyncResult(makeSyncResult({ created: 5 }), new Date());

			expect(svc.getLatest()!.notesCreated).toBe(5);
		});
	});

	describe('getReports', () => {
		it('returns reports most-recent first', () => {
			svc.recordSyncResult(makeSyncResult({ created: 1 }), new Date());
			svc.recordSyncResult(makeSyncResult({ created: 2 }), new Date());
			svc.recordSyncResult(makeSyncResult({ created: 3 }), new Date());

			const reports = svc.getReports();
			expect(reports[0].notesCreated).toBe(3);
			expect(reports[1].notesCreated).toBe(2);
			expect(reports[2].notesCreated).toBe(1);
		});

		it('returns a copy — mutating the returned array does not affect internal state', () => {
			svc.recordSyncResult(makeSyncResult(), new Date());
			const reports = svc.getReports();
			reports.push({} as any);

			expect(svc.getReports()).toHaveLength(1);
		});
	});

	describe('MAX_REPORTS cap (10)', () => {
		it('does not store more than 10 reports', () => {
			for (let i = 0; i < 15; i++) {
				svc.recordSyncResult(makeSyncResult({ created: i }), new Date());
			}
			expect(svc.getReports()).toHaveLength(10);
		});

		it('oldest reports are dropped when cap is exceeded', () => {
			for (let i = 0; i < 12; i++) {
				svc.recordSyncResult(makeSyncResult({ created: i }), new Date());
			}
			const reports = svc.getReports();
			// Most recent is created=11; oldest retained should be created=2
			expect(reports[0].notesCreated).toBe(11);
			expect(reports[9].notesCreated).toBe(2);
		});
	});

	describe('clear', () => {
		it('removes all stored reports', () => {
			svc.recordSyncResult(makeSyncResult(), new Date());
			svc.recordSyncResult(makeSyncResult(), new Date());
			svc.clear();

			expect(svc.getReports()).toHaveLength(0);
			expect(svc.getLatest()).toBeNull();
		});
	});
});
