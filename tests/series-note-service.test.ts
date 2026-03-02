/**
 * Unit tests for SeriesNoteService.
 *
 * Covers:
 *   1. extractSeriesTasks  — correct extraction & marker stripping
 *   2. extractDecisionsFromSlot — reads CB_DECISIONS block from note content
 *   3. parseNoteDate — frontmatter / filename / mtime fallback chain
 *   4. updateSeriesNote — idempotent update with full mock vault
 */

import { App, TFile } from 'obsidian';
import {
	extractSeriesTasks,
	extractDecisionsFromSlot,
	parseNoteDate,
	updateSeriesNote,
} from '../src/services/SeriesNoteService';
import { DEFAULT_SETTINGS } from '../src/types';

// Test-only helper to access mock vault helpers without real-type friction
type MockVault = {
	writeFile: (path: string, content: string, mtime?: number) => void;
	readByPath: (path: string) => string | undefined;
};
const mockVault = (app: App) => app.vault as unknown as MockVault;
// Create a TFile with optional mtime (mock supports it, real Obsidian doesn't)
const makeTFile = (path: string, mtime = 0) =>
	new (TFile as unknown as new (path: string, mtime: number) => TFile)(path, mtime);

// ─── extractSeriesTasks ───────────────────────────────────────────────────────

describe('extractSeriesTasks', () => {
	const MARKER = '^series';

	it('extracts incomplete tasks with the marker', () => {
		const content = [
			'- [ ] Do something important ^series',
			'- [ ] Another task ^series',
		].join('\n');
		const result = extractSeriesTasks(content, MARKER);
		expect(result).toEqual([
			'- [ ] Do something important',
			'- [ ] Another task',
		]);
	});

	it('strips the marker from returned text', () => {
		const content = '- [ ] Task with marker ^series';
		const [task] = extractSeriesTasks(content, MARKER);
		expect(task).toBe('- [ ] Task with marker');
		expect(task).not.toContain(MARKER);
	});

	it('ignores completed tasks', () => {
		const content = '- [x] Already done ^series';
		expect(extractSeriesTasks(content, MARKER)).toHaveLength(0);
	});

	it('ignores tasks without the marker', () => {
		const content = '- [ ] No marker here';
		expect(extractSeriesTasks(content, MARKER)).toHaveLength(0);
	});

	it('handles asterisk list prefix', () => {
		const content = '* [ ] Star task ^series';
		const result = extractSeriesTasks(content, MARKER);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe('- [ ] Star task');
	});

	it('handles indented tasks', () => {
		const content = '  - [ ] Indented task ^series';
		const result = extractSeriesTasks(content, MARKER);
		expect(result).toHaveLength(1);
	});

	it('returns empty array when no content matches', () => {
		expect(extractSeriesTasks('No tasks here.', MARKER)).toEqual([]);
	});

	it('handles custom markers', () => {
		const content = '- [ ] Custom marker task ^track-me';
		const result = extractSeriesTasks(content, '^track-me');
		expect(result).toHaveLength(1);
		expect(result[0]).toBe('- [ ] Custom marker task');
	});
});

// ─── extractDecisionsFromSlot ─────────────────────────────────────────────────

describe('extractDecisionsFromSlot', () => {
	const NOW = new Date('2026-01-15');
	const PATH = 'Meetings/2026-01-15 Standup.md';

	function wrapDecisions(body: string): string {
		return `<!-- CB:BEGIN CB_DECISIONS -->\n${body}\n<!-- CB:END CB_DECISIONS -->`;
	}

	it('extracts one decision per non-empty line', () => {
		const content = wrapDecisions('Use TypeScript\nDeploy on Fridays');
		const decisions = extractDecisionsFromSlot(content, PATH, NOW);
		expect(decisions).toHaveLength(2);
		expect(decisions[0].text).toBe('Use TypeScript');
		expect(decisions[1].text).toBe('Deploy on Fridays');
	});

	it('attaches the correct sourcePath and sourceDate', () => {
		const content = wrapDecisions('Decision text');
		const [d] = extractDecisionsFromSlot(content, PATH, NOW);
		expect(d.sourcePath).toBe(PATH);
		expect(d.sourceDate).toBe(NOW);
	});

	it('returns empty array when no CB_DECISIONS block exists', () => {
		expect(extractDecisionsFromSlot('No block here', PATH, NOW)).toEqual([]);
	});

	it('returns empty array when CB_DECISIONS block is empty', () => {
		const content = wrapDecisions('   ');
		expect(extractDecisionsFromSlot(content, PATH, NOW)).toEqual([]);
	});

	it('skips blank lines within the block', () => {
		const content = wrapDecisions('Decision A\n\nDecision B');
		const decisions = extractDecisionsFromSlot(content, PATH, NOW);
		expect(decisions).toHaveLength(2);
	});
});

// ─── parseNoteDate ────────────────────────────────────────────────────────────

describe('parseNoteDate', () => {
	it('reads date from frontmatter start: field', () => {
		const file = makeTFile('Meetings/some-meeting.md', 0);
		const content = '---\nstart: 2026-03-01T09:00:00Z\ntitle: Test\n---\n# Body';
		const d = parseNoteDate(content, file);
		expect(d.getUTCFullYear()).toBe(2026);
		expect(d.getUTCMonth()).toBe(2); // 0-indexed March
		expect(d.getUTCDate()).toBe(1);
	});

	it('reads date from frontmatter date: field', () => {
		const file = makeTFile('Meetings/some-meeting.md', 0);
		const content = '---\ndate: 2025-11-20\n---\n# Body';
		const d = parseNoteDate(content, file);
		expect(d.getFullYear()).toBe(2025);
	});

	it('falls back to YYYY-MM-DD in filename', () => {
		const file = makeTFile('Meetings/2026-02-14 Team Standup.md', 0);
		const d = parseNoteDate('No frontmatter here', file);
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(1); // February
		expect(d.getDate()).toBe(14);
	});

	it('falls back to mtime when no date available', () => {
		const MTIME = new Date('2026-01-01').getTime();
		const file = makeTFile('Meetings/untitled.md', MTIME);
		const d = parseNoteDate('No date info', file);
		expect(d.getTime()).toBe(MTIME);
	});
});

// ─── updateSeriesNote ─────────────────────────────────────────────────────────

describe('updateSeriesNote', () => {
	const NOW = new Date('2026-01-20T12:00:00Z');
	const SERIES_PATH = 'Meetings/_series/daily-standup.md';
	const SETTINGS = {
		...DEFAULT_SETTINGS,
		seriesActionMarker: '^series',
		seriesDecisionHorizonDays: 30,
		seriesDecisionLookbackNotes: 10,
		seriesDropExpiredDecisionsByDate: false,
	};

	function makeSeriesSkeleton(): string {
		return [
			'---',
			'type: meeting_series',
			'---',
			'# Daily Standup',
			'',
			'## Open Actions',
			'<!-- CB:BEGIN CB_SERIES_ACTIONS -->',
			'<!-- CB:END CB_SERIES_ACTIONS -->',
			'',
			'## Active Decisions',
			'<!-- CB:BEGIN CB_SERIES_DECISIONS -->',
			'<!-- CB:END CB_SERIES_DECISIONS -->',
			'',
			'## Meetings',
			'<!-- CB:BEGIN CB_SERIES_MEETINGS_INDEX -->',
			'<!-- CB:END CB_SERIES_MEETINGS_INDEX -->',
			'',
			'<!-- CB:BEGIN CB_SERIES_DIAGNOSTICS -->',
			'<!-- CB:END CB_SERIES_DIAGNOSTICS -->',
		].join('\n');
	}

	function makeMeetingContent(opts: {
		seriesKey?: string;
		tasks?: string[];
		decisions?: string[];
		date?: string;
	} = {}): string {
		const fm = [
			'---',
			`series_key: ${opts.seriesKey ?? 'ical:standup'}`,
			`start: ${opts.date ?? '2026-01-15T09:00:00Z'}`,
			'---',
		].join('\n');

		const taskLines = (opts.tasks ?? []).join('\n');
		const decisionLines = (opts.decisions ?? []).join('\n');

		const decisions = decisionLines
			? `<!-- CB:BEGIN CB_DECISIONS -->\n${decisionLines}\n<!-- CB:END CB_DECISIONS -->`
			: '';

		return [fm, taskLines, decisions].filter(Boolean).join('\n');
	}

	it('does nothing when series note does not exist', async () => {
		const app = new App();
		// Don't create the series note — vault is empty
		const file = makeTFile('Meetings/standup-1.md', 1000);
		mockVault(app).writeFile(file.path, makeMeetingContent({ tasks: ['- [ ] Task ^series'] }), 1000);

		// Should resolve without throwing
		await expect(
			updateSeriesNote(app as never, SERIES_PATH, 'Daily Standup', [file], SETTINGS, NOW),
		).resolves.toBeUndefined();
	});

	it('populates CB_SERIES_ACTIONS with ^series tasks from meeting files', async () => {
		const app = new App();
		mockVault(app).writeFile(
			SERIES_PATH,
			makeSeriesSkeleton(),
			500,
		);

		const meetingFile = makeTFile('Meetings/2026-01-15 Standup.md', 1000);
		mockVault(app).writeFile(
			meetingFile.path,
			makeMeetingContent({ tasks: ['- [ ] Follow up with Bob ^series', '- [ ] Update docs ^series'] }),
			1000,
		);

		await updateSeriesNote(app as never, SERIES_PATH, 'Daily Standup', [meetingFile], SETTINGS, NOW);

		const updated = mockVault(app).readByPath(SERIES_PATH) ?? '';
		expect(updated).toContain('- [ ] Follow up with Bob');
		expect(updated).toContain('- [ ] Update docs');
		expect(updated).not.toContain('^series');
	});

	it('populates CB_SERIES_MEETINGS_INDEX with wikilinks', async () => {
		const app = new App();
		mockVault(app).writeFile(SERIES_PATH, makeSeriesSkeleton(), 500);

		const f1 = makeTFile('Meetings/2026-01-15 Standup.md', 2000);
		const f2 = makeTFile('Meetings/2026-01-08 Standup.md', 1000);
		mockVault(app).writeFile(f1.path, makeMeetingContent({ date: '2026-01-15T09:00:00Z' }), 2000);
		mockVault(app).writeFile(f2.path, makeMeetingContent({ date: '2026-01-08T09:00:00Z' }), 1000);

		await updateSeriesNote(app as never, SERIES_PATH, 'Daily Standup', [f1, f2], SETTINGS, NOW);

		const updated = mockVault(app).readByPath(SERIES_PATH) ?? '';
		expect(updated).toContain('[[2026-01-15 Standup]]');
		expect(updated).toContain('[[2026-01-08 Standup]]');
	});

	it('is idempotent — calling twice produces the same result', async () => {
		const app = new App();
		mockVault(app).writeFile(SERIES_PATH, makeSeriesSkeleton(), 500);

		const meetingFile = makeTFile('Meetings/2026-01-15 Standup.md', 1000);
		mockVault(app).writeFile(
			meetingFile.path,
			makeMeetingContent({ tasks: ['- [ ] Idempotent task ^series'] }),
			1000,
		);

		await updateSeriesNote(app as never, SERIES_PATH, 'Daily Standup', [meetingFile], SETTINGS, NOW);
		const afterFirst = mockVault(app).readByPath(SERIES_PATH) ?? '';

		await updateSeriesNote(app as never, SERIES_PATH, 'Daily Standup', [meetingFile], SETTINGS, NOW);
		const afterSecond = mockVault(app).readByPath(SERIES_PATH) ?? '';

		expect(afterSecond).toBe(afterFirst);
	});

	it('does not modify series note when nothing changed', async () => {
		const app = new App();
		mockVault(app).writeFile(SERIES_PATH, makeSeriesSkeleton(), 500);

		const meetingFile = makeTFile('Meetings/2026-01-15 Standup.md', 1000);
		mockVault(app).writeFile(meetingFile.path, makeMeetingContent(), 1000);

		await updateSeriesNote(app as never, SERIES_PATH, 'Daily Standup', [meetingFile], SETTINGS, NOW);
		const afterFirst = mockVault(app).readByPath(SERIES_PATH) ?? '';

		// Spy on vault.modify to confirm it is NOT called on second pass
		const modifySpy = jest.spyOn(app.vault, 'modify');
		await updateSeriesNote(app as never, SERIES_PATH, 'Daily Standup', [meetingFile], SETTINGS, NOW);

		expect(modifySpy).not.toHaveBeenCalled();
		modifySpy.mockRestore();

		expect(mockVault(app).readByPath(SERIES_PATH)).toBe(afterFirst);
	});

	it('populates CB_SERIES_DIAGNOSTICS with metadata', async () => {
		const app = new App();
		mockVault(app).writeFile(SERIES_PATH, makeSeriesSkeleton(), 500);

		const meetingFile = makeTFile('Meetings/2026-01-15 Standup.md', 1000);
		mockVault(app).writeFile(meetingFile.path, makeMeetingContent(), 1000);

		await updateSeriesNote(app as never, SERIES_PATH, 'Daily Standup', [meetingFile], SETTINGS, NOW);

		const updated = mockVault(app).readByPath(SERIES_PATH) ?? '';
		expect(updated).toContain('Daily Standup');
		expect(updated).toContain('Total meetings:');
	});
});
