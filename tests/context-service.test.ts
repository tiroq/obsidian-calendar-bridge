/**
 * Tests for ContextService
 */
import { App } from 'obsidian';
import { ContextService, extractContextSnippet } from '../src/services/ContextService';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeApp(): App {
	return new App();
}

/** Write a meeting note for a given series_key into the mock vault. */
function addNote(
	app: App,
	folder: string,
	filename: string,
	content: string,
	mtime = Date.now(),
): void {
	(app.vault as unknown as { writeFile: (p: string, c: string, m: number) => void })
		.writeFile(`${folder}/${filename}`, content, mtime);
}

const FOLDER = 'Meetings';
const SERIES = 'gcal:abc123';

// ─── extractContextSnippet (pure helper) ────────────────────────────────────

describe('extractContextSnippet', () => {
	it('returns empty string for blank content', () => {
		expect(extractContextSnippet('', 'path.md')).toBe('');
	});

	it('extracts CB_CONTEXT slot when present', () => {
		const content = [
			'<!-- CB:BEGIN CB_CONTEXT -->',
			'Previous decision: ship by Friday',
			'<!-- CB:END CB_CONTEXT -->',
		].join('\n');
		const result = extractContextSnippet(content, 'notes/meeting.md');
		expect(result).toContain('Previous decision: ship by Friday');
		expect(result).toContain('<!-- from notes/meeting.md -->');
	});

	it('falls back to CB_DECISIONS when CB_CONTEXT is absent', () => {
		const content = [
			'<!-- CB:BEGIN CB_DECISIONS -->',
			'Agreed to postpone launch',
			'<!-- CB:END CB_DECISIONS -->',
		].join('\n');
		const result = extractContextSnippet(content, 'notes/x.md');
		expect(result).toContain('Agreed to postpone launch');
		expect(result).toContain('(decisions)');
	});

	it('falls back to ## Notes section when no CB slots', () => {
		const content = [
			'# Meeting Title',
			'## Agenda',
			'- item 1',
			'## Notes',
			'First note line',
			'Second note line',
			'Third note line',
			'Fourth note line (should be omitted)',
			'## Actions',
		].join('\n');
		const result = extractContextSnippet(content, 'x.md');
		expect(result).toContain('First note line');
		expect(result).toContain('Second note line');
		expect(result).toContain('Third note line');
		// Only first 3 lines
		expect(result).not.toContain('Fourth note line');
	});

	it('prefers CB_CONTEXT over CB_DECISIONS', () => {
		const content = [
			'<!-- CB:BEGIN CB_CONTEXT -->',
			'ctx content',
			'<!-- CB:END CB_CONTEXT -->',
			'<!-- CB:BEGIN CB_DECISIONS -->',
			'dec content',
			'<!-- CB:END CB_DECISIONS -->',
		].join('\n');
		const result = extractContextSnippet(content, 'x.md');
		expect(result).toContain('ctx content');
		expect(result).not.toContain('dec content');
	});

	it('returns empty string if ## Notes section is empty', () => {
		const content = '## Notes\n\n## Actions\n';
		expect(extractContextSnippet(content, 'x.md')).toBe('');
	});

	it('includes source path in comment', () => {
		const content = '<!-- CB:BEGIN CB_CONTEXT -->\nHello\n<!-- CB:END CB_CONTEXT -->';
		expect(extractContextSnippet(content, 'Meetings/note.md')).toContain('Meetings/note.md');
	});
});

// ─── ContextService ──────────────────────────────────────────────────────────

describe('ContextService', () => {
	it('returns empty result when folder does not exist', async () => {
		const app = makeApp();
		const svc = new ContextService(app);
		const result = await svc.buildContext({ seriesKey: SERIES, notesFolder: 'NonExistent' });
		expect(result.content).toBe('');
		expect(result.scanned).toBe(0);
		expect(result.sourcePaths).toHaveLength(0);
	});

	it('returns empty result when folder exists but no matching notes', async () => {
		const app = makeApp();
		// Create folder by adding a note for a different series
		addNote(app, FOLDER, 'other.md', 'series_key: gcal:other\n# Meeting\n');
		// Make folder "exist"
		(app.vault as unknown as { folders: Set<string> })
			['folders' as never] as Set<string>; // just ensure file is in vault
		const svc = new ContextService(app);
		const result = await svc.buildContext({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.content).toBe('');
		expect(result.scanned).toBe(0);
	});

	it('extracts context from a single matching note', async () => {
		const app = makeApp();
		const noteContent = [
			'---',
			`series_key: ${SERIES}`,
			'---',
			'<!-- CB:BEGIN CB_CONTEXT -->',
			'Decision: use TypeScript',
			'<!-- CB:END CB_CONTEXT -->',
		].join('\n');
		addNote(app, FOLDER, '2026-01-01 Meeting.md', noteContent, 1000);
		const svc = new ContextService(app);
		const result = await svc.buildContext({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.content).toContain('Decision: use TypeScript');
		expect(result.scanned).toBe(1);
		expect(result.sourcePaths).toHaveLength(1);
	});

	it('respects maxLookback and picks most recent notes', async () => {
		const app = makeApp();
		for (let i = 1; i <= 5; i++) {
			addNote(app, FOLDER, `meeting-${i}.md`, [
				`series_key: ${SERIES}`,
				`<!-- CB:BEGIN CB_CONTEXT -->`,
				`Context from meeting ${i}`,
				`<!-- CB:END CB_CONTEXT -->`,
			].join('\n'), i * 1000); // mtime = i*1000 → meeting-5 is most recent
		}
		const svc = new ContextService(app);
		const result = await svc.buildContext({ seriesKey: SERIES, notesFolder: FOLDER, maxLookback: 2 });
		// Should have scanned exactly 2 (the 2 most recent by mtime)
		expect(result.scanned).toBe(2);
		// Should include content from notes 4 and 5 (highest mtime)
		expect(result.content).toContain('Context from meeting 5');
		expect(result.content).toContain('Context from meeting 4');
		expect(result.content).not.toContain('Context from meeting 3');
	});

	it('returns empty content when notes exist but have no extractable context', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'note.md', `series_key: ${SERIES}\n# Boring meeting\nno context here`, 1000);
		const svc = new ContextService(app);
		const result = await svc.buildContext({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.content).toBe('');
		expect(result.scanned).toBe(1);
		expect(result.sourcePaths).toHaveLength(0); // no path contributed
	});

	it('caches result on second call', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'cached.md', [
			`series_key: ${SERIES}`,
			'<!-- CB:BEGIN CB_CONTEXT -->',
			'Cached content',
			'<!-- CB:END CB_CONTEXT -->',
		].join('\n'), 1000);
		const svc = new ContextService(app);
		const spy = jest.spyOn(app.vault, 'read');
		await svc.buildContext({ seriesKey: SERIES, notesFolder: FOLDER });
		const callCount = spy.mock.calls.length;
		await svc.buildContext({ seriesKey: SERIES, notesFolder: FOLDER });
		// Second call should NOT have added more read() calls
		expect(spy.mock.calls.length).toBe(callCount);
	});

	it('clearCache causes re-read on next call', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'c.md', `series_key: ${SERIES}\n## Notes\nLine one`, 1000);
		const svc = new ContextService(app);
		await svc.buildContext({ seriesKey: SERIES, notesFolder: FOLDER });
		svc.clearCache();
		const spy = jest.spyOn(app.vault, 'read');
		await svc.buildContext({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(spy).toHaveBeenCalled();
	});

	it('ignores notes from different series', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'other.md', [
			'series_key: gcal:OTHER',
			'<!-- CB:BEGIN CB_CONTEXT -->',
			'Should not appear',
			'<!-- CB:END CB_CONTEXT -->',
		].join('\n'), 2000);
		addNote(app, FOLDER, 'mine.md', [
			`series_key: ${SERIES}`,
			'<!-- CB:BEGIN CB_CONTEXT -->',
			'Should appear',
			'<!-- CB:END CB_CONTEXT -->',
		].join('\n'), 1000);
		const svc = new ContextService(app);
		const result = await svc.buildContext({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.content).toContain('Should appear');
		expect(result.content).not.toContain('Should not appear');
	});

	it('only scans .md files', async () => {
		const app = makeApp();
		// Write a non-.md file with the series_key in its name
		(app.vault as unknown as { writeFile: (p: string, c: string, m: number) => void })
			.writeFile(`${FOLDER}/data.json`, `{"series_key":"${SERIES}"}`, 9999);
		addNote(app, FOLDER, 'real.md', `series_key: ${SERIES}\n## Notes\nActual content`, 1000);
		const svc = new ContextService(app);
		const result = await svc.buildContext({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.scanned).toBe(1); // only the .md file
	});

	it('joins multiple snippets with double newline', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'a.md', `series_key: ${SERIES}\n## Notes\nNote A line 1`, 1000);
		addNote(app, FOLDER, 'b.md', `series_key: ${SERIES}\n## Notes\nNote B line 1`, 2000);
		const svc = new ContextService(app);
		const result = await svc.buildContext({ seriesKey: SERIES, notesFolder: FOLDER, maxLookback: 2 });
		expect(result.content).toContain('\n\n');
	});
});
