/**
 * Tests for MetricsService
 */
import { App } from 'obsidian';
import { MetricsService, formatMetrics, SeriesMetrics } from '../src/services/MetricsService';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeApp(): App {
	return new App();
}

function addNote(app: App, folder: string, filename: string, content: string, mtime = Date.now()): void {
	(app.vault as unknown as { writeFile: (p: string, c: string, m: number) => void })
		.writeFile(`${folder}/${filename}`, content, mtime);
}

const FOLDER = 'Meetings';
const SERIES = 'gcal:abc123';

/** Build a note with frontmatter + optional CB_DECISIONS + optional checkboxes. */
function buildNote(opts: {
	seriesKey?: string;
	start?: string;
	attendees?: string[];
	hasDecisions?: boolean;
	openActions?: number;
	completedActions?: number;
}): string {
	const sk = opts.seriesKey ?? SERIES;
	const start = opts.start ?? '2026-01-01T09:00:00Z';
	const attendees = opts.attendees ?? [];
	const atLines = attendees.map(a => `  - ${a}`).join('\n');
	const frontmatter = [
		'---',
		`series_key: ${sk}`,
		`start: ${start}`,
		...(attendees.length > 0 ? ['attendees:', atLines] : []),
		'---',
	].join('\n');

	const decisions = opts.hasDecisions
		? `\n<!-- CB:BEGIN CB_DECISIONS -->\nDecided something\n<!-- CB:END CB_DECISIONS -->`
		: '';
	const open = Array.from({ length: opts.openActions ?? 0 }, (_, i) => `- [ ] Open task ${i + 1}`).join('\n');
	const done = Array.from({ length: opts.completedActions ?? 0 }, (_, i) => `- [x] Done task ${i + 1}`).join('\n');

	return [frontmatter, decisions, open, done].filter(Boolean).join('\n');
}

// ─── formatMetrics (pure helper) ────────────────────────────────────────────

describe('formatMetrics', () => {
	const m: SeriesMetrics = {
		totalNotes: 10,
		lastMeetingDate: '2026-01-15',
		avgAttendeeCount: 4.5,
		completionRate: 80,
		openActionCount: 3,
	};

	it('returns a markdown table', () => {
		const result = formatMetrics(m);
		expect(result).toContain('| Metric | Value |');
		expect(result).toContain('|--------|-------|');
	});

	it('includes all metric rows', () => {
		const result = formatMetrics(m);
		expect(result).toContain('| Notes | 10 |');
		expect(result).toContain('| Last meeting | 2026-01-15 |');
		expect(result).toContain('| Avg attendees | 4.5 |');
		expect(result).toContain('| Completion rate | 80% |');
		expect(result).toContain('| Open actions | 3 |');
	});

	it('renders null lastMeetingDate as em-dash', () => {
		const result = formatMetrics({ ...m, lastMeetingDate: null });
		expect(result).toContain('| Last meeting | — |');
	});
});

// ─── MetricsService ──────────────────────────────────────────────────────────

describe('MetricsService', () => {
	it('returns zero metrics when folder does not exist', async () => {
		const app = makeApp();
		const svc = new MetricsService(app);
		const result = await svc.computeMetrics({ seriesKey: SERIES, notesFolder: 'NoFolder' });
		expect(result.totalNotes).toBe(0);
		expect(result.lastMeetingDate).toBeNull();
		expect(result.avgAttendeeCount).toBe(0);
		expect(result.completionRate).toBe(0);
		expect(result.openActionCount).toBe(0);
	});

	it('returns zero metrics when no matching notes exist', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'other.md', buildNote({ seriesKey: 'gcal:OTHER' }), 1000);
		const svc = new MetricsService(app);
		const result = await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.totalNotes).toBe(0);
	});

	it('counts total notes correctly', async () => {
		const app = makeApp();
		for (let i = 1; i <= 4; i++) {
			addNote(app, FOLDER, `m${i}.md`, buildNote({ start: `2026-01-0${i}T09:00:00Z` }), i * 1000);
		}
		const svc = new MetricsService(app);
		const result = await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.totalNotes).toBe(4);
	});

	it('extracts lastMeetingDate from most-recent note frontmatter', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'older.md', buildNote({ start: '2026-01-01T09:00:00Z' }), 1000);
		addNote(app, FOLDER, 'newer.md', buildNote({ start: '2026-03-15T09:00:00Z' }), 2000);
		const svc = new MetricsService(app);
		const result = await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER });
		// Most recent by mtime is "newer.md"
		expect(result.lastMeetingDate).toBe('2026-03-15');
	});

	it('computes average attendee count', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'a.md', buildNote({ attendees: ['Alice', 'Bob'] }), 2000);
		addNote(app, FOLDER, 'b.md', buildNote({ attendees: ['Charlie', 'Dave', 'Eve'] }), 1000);
		const svc = new MetricsService(app);
		const result = await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER });
		// (2 + 3) / 2 = 2.5
		expect(result.avgAttendeeCount).toBe(2.5);
	});

	it('computes completion rate based on notes with decisions or completed actions', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'done1.md', buildNote({ hasDecisions: true }), 3000);
		addNote(app, FOLDER, 'done2.md', buildNote({ completedActions: 1 }), 2000);
		addNote(app, FOLDER, 'empty.md', buildNote({}), 1000);
		const svc = new MetricsService(app);
		const result = await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER });
		// 2 out of 3 notes have content → 66%
		expect(result.completionRate).toBe(67); // Math.round(2/3 * 100)
	});

	it('counts open actions correctly', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'n1.md', buildNote({ openActions: 3 }), 2000);
		addNote(app, FOLDER, 'n2.md', buildNote({ openActions: 2 }), 1000);
		const svc = new MetricsService(app);
		const result = await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.openActionCount).toBe(5);
	});

	it('maxScan limits notes scanned for metrics (not total count)', async () => {
		const app = makeApp();
		for (let i = 1; i <= 10; i++) {
			addNote(app, FOLDER, `m${i}.md`, buildNote({ openActions: 1 }), i * 1000);
		}
		const svc = new MetricsService(app);
		const result = await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER, maxScan: 3 });
		expect(result.totalNotes).toBe(10); // all 10 counted
		expect(result.openActionCount).toBe(3); // only 3 scanned for action counts
	});

	it('caches result on repeated call', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'x.md', buildNote({}), 1000);
		const svc = new MetricsService(app);
		const spy = jest.spyOn(app.vault, 'read');
		await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER });
		const callCount = spy.mock.calls.length;
		await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(spy.mock.calls.length).toBe(callCount);
	});

	it('clearCache causes re-computation on next call', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'y.md', buildNote({}), 1000);
		const svc = new MetricsService(app);
		await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER });
		svc.clearCache();
		const spy = jest.spyOn(app.vault, 'read');
		await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(spy).toHaveBeenCalled();
	});

	it('renderMetricsBlock returns markdown table string', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'z.md', buildNote({ hasDecisions: true, openActions: 1 }), 1000);
		const svc = new MetricsService(app);
		const block = await svc.renderMetricsBlock({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(block).toContain('| Notes |');
		expect(block).toContain('| Completion rate |');
	});

	it('ignores non-.md files', async () => {
		const app = makeApp();
		(app.vault as unknown as { writeFile: (p: string, c: string, m: number) => void })
			.writeFile(`${FOLDER}/data.json`, `series_key: ${SERIES}`, 9999);
		addNote(app, FOLDER, 'real.md', buildNote({ openActions: 2 }), 1000);
		const svc = new MetricsService(app);
		const result = await svc.computeMetrics({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.totalNotes).toBe(1);
	});
});
