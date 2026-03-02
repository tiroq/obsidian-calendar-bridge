/**
 * Tests for ActionAggregationService
 */
import { App } from 'obsidian';
import { ActionAggregationService, extractActions } from '../src/services/ActionAggregationService';

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

// ─── extractActions (pure helper) ───────────────────────────────────────────

describe('extractActions', () => {
	it('returns empty array for blank content', () => {
		expect(extractActions('')).toEqual([]);
	});

	it('extracts actions from CB_ACTIONS slot (incomplete only)', () => {
		const content = [
			'<!-- CB:BEGIN CB_ACTIONS -->',
			'- [ ] Send report',
			'- [x] Deploy staging',
			'- [ ] Update docs',
			'<!-- CB:END CB_ACTIONS -->',
		].join('\n');
		const result = extractActions(content);
		expect(result).toContain('Send report');
		expect(result).toContain('Update docs');
		expect(result).not.toContain('Deploy staging');
	});

	it('extracts unchecked checkboxes from anywhere in note when no CB_ACTIONS slot', () => {
		const content = [
			'# Notes',
			'- [ ] Follow up with Alice',
			'- [x] Done task',
			'- [ ] Review PR',
		].join('\n');
		const result = extractActions(content);
		expect(result).toContain('Follow up with Alice');
		expect(result).toContain('Review PR');
		expect(result).not.toContain('Done task');
	});

	it('falls back to ## Actions section when no checkboxes', () => {
		const content = [
			'## Actions',
			'- Send report',
			'- Schedule meeting',
		].join('\n');
		const result = extractActions(content);
		expect(result).toContain('Send report');
		expect(result).toContain('Schedule meeting');
	});

	it('recognises ## Action Items heading', () => {
		const content = '## Action Items\n- Deploy fix\n- Write test\n';
		const result = extractActions(content);
		expect(result).toContain('Deploy fix');
		expect(result).toContain('Write test');
	});

	it('recognises ## TODO heading', () => {
		const content = '## TODO\n- Refactor auth\n';
		const result = extractActions(content);
		expect(result).toContain('Refactor auth');
	});

	it('CB_ACTIONS slot takes priority over checkboxes', () => {
		const content = [
			'<!-- CB:BEGIN CB_ACTIONS -->',
			'- [ ] Slot action',
			'<!-- CB:END CB_ACTIONS -->',
			'- [ ] Checkbox outside slot',
		].join('\n');
		const result = extractActions(content);
		expect(result).toContain('Slot action');
		// Checkbox outside the slot should not appear (slot took priority and returned early)
		expect(result).not.toContain('Checkbox outside slot');
	});

	it('returns empty array when all checkboxes are completed', () => {
		const content = '- [x] Already done\n- [X] Also done\n';
		expect(extractActions(content)).toEqual([]);
	});

	it('supports * bullet syntax in unchecked checkboxes', () => {
		const content = '* [ ] Star bullet action\n';
		const result = extractActions(content);
		expect(result).toContain('Star bullet action');
	});

	it('ignores CB marker lines within a CB_ACTIONS slot (corrupted note)', () => {
		// A note where a previous sync produced nested markers:
		const content = [
			'<!-- CB:BEGIN CB_ACTIONS -->',
			'<!-- CB:BEGIN CB_ACTIONS -->',
			'- [ ] Real task',
			'<!-- CB:END CB_ACTIONS -->',
			'<!-- CB:END CB_ACTIONS -->',
		].join('\n');
		const result = extractActions(content);
		expect(result).toContain('Real task');
		expect(result).not.toContain('CB:BEGIN');
		expect(result).not.toContain('CB:END');
		expect(result.some(a => a.startsWith('<!--'))).toBe(false);
	});

	it('ignores empty checkbox placeholder (- [ ] with no text)', () => {
		const content = [
			'<!-- CB:BEGIN CB_ACTIONS -->',
			'- [ ]',
			'- [ ] Real action',
			'<!-- CB:END CB_ACTIONS -->',
		].join('\n');
		const result = extractActions(content);
		expect(result).toContain('Real action');
		expect(result.filter(a => a === '')).toHaveLength(0);
	});

	it('ignores code fences within an action section heading', () => {
		const content = [
			'## Action Items',
			'- Do the thing',
			'\`\`\`',
			'some code',
			'\`\`\`',
		].join('\n');
		const result = extractActions(content);
		expect(result).toContain('Do the thing');
		expect(result.some(a => a.includes('\`\`\`'))).toBe(false);
		expect(result).not.toContain('some code');
	});
});

// ─── ActionAggregationService ───────────────────────────────────────────────

describe('ActionAggregationService', () => {
	it('returns empty result when folder does not exist', async () => {
		const app = makeApp();
		const svc = new ActionAggregationService(app);
		const result = await svc.aggregateActions({ seriesKey: SERIES, notesFolder: 'NoFolder' });
		expect(result.content).toBe('');
		expect(result.actions).toHaveLength(0);
		expect(result.scanned).toBe(0);
	});

	it('returns empty result when no matching notes', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'other.md', 'series_key: gcal:OTHER\n');
		const svc = new ActionAggregationService(app);
		const result = await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.content).toBe('');
		expect(result.scanned).toBe(0);
	});

	it('extracts open actions from a single note', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'note.md', [
			`series_key: ${SERIES}`,
			'- [ ] Write tests',
			'- [x] Deploy',
			'- [ ] Update docs',
		].join('\n'), 1000);
		const svc = new ActionAggregationService(app);
		const result = await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.actions).toContain('Write tests');
		expect(result.actions).toContain('Update docs');
		expect(result.actions).not.toContain('Deploy');
		expect(result.content).toContain('- [ ] Write tests');
	});

	it('deduplicates actions across multiple notes (case-insensitive)', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'a.md', `series_key: ${SERIES}\n- [ ] Send report\n`, 2000);
		addNote(app, FOLDER, 'b.md', `series_key: ${SERIES}\n- [ ] send report\n`, 1000); // duplicate, different case
		const svc = new ActionAggregationService(app);
		const result = await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		// Should only have one "send report" entry
		const sendReportCount = result.actions.filter(a =>
			a.toLowerCase() === 'send report',
		).length;
		expect(sendReportCount).toBe(1);
	});

	it('respects maxLookback (picks most recent notes)', async () => {
		const app = makeApp();
		for (let i = 1; i <= 6; i++) {
			addNote(app, FOLDER, `m${i}.md`, [
				`series_key: ${SERIES}`,
				`- [ ] Action from note ${i}`,
			].join('\n'), i * 1000);
		}
		const svc = new ActionAggregationService(app);
		const result = await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER, maxLookback: 3 });
		expect(result.scanned).toBe(3);
		// Most recent 3 are notes 4, 5, 6
		expect(result.actions).toContain('Action from note 6');
		expect(result.actions).toContain('Action from note 5');
		expect(result.actions).toContain('Action from note 4');
		expect(result.actions).not.toContain('Action from note 3');
	});

	it('formats content as checkbox list', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'n.md', `series_key: ${SERIES}\n- [ ] Task A\n- [ ] Task B`, 1000);
		const svc = new ActionAggregationService(app);
		const result = await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.content).toMatch(/^- \[ \] Task A/m);
		expect(result.content).toMatch(/^- \[ \] Task B/m);
	});

	it('returns empty content string when no actions found', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'done.md', `series_key: ${SERIES}\n- [x] Already done`, 1000);
		const svc = new ActionAggregationService(app);
		const result = await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.content).toBe('');
		expect(result.actions).toHaveLength(0);
	});

	it('caches result on repeated call', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'c.md', `series_key: ${SERIES}\n- [ ] Cached action`, 1000);
		const svc = new ActionAggregationService(app);
		const spy = jest.spyOn(app.vault, 'read');
		await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		const callCount = spy.mock.calls.length;
		await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(spy.mock.calls.length).toBe(callCount);
	});

	it('clearCache causes re-execution on next call', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'r.md', `series_key: ${SERIES}\n- [ ] Refreshable`, 1000);
		const svc = new ActionAggregationService(app);
		await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		svc.clearCache();
		const spy = jest.spyOn(app.vault, 'read');
		await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(spy).toHaveBeenCalled();
	});

	it('ignores notes from different series', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'other.md', 'series_key: gcal:OTHER\n- [ ] Other action', 2000);
		addNote(app, FOLDER, 'mine.md', `series_key: ${SERIES}\n- [ ] My action`, 1000);
		const svc = new ActionAggregationService(app);
		const result = await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.actions).toContain('My action');
		expect(result.actions).not.toContain('Other action');
	});

	it('only processes .md files', async () => {
		const app = makeApp();
		(app.vault as unknown as { writeFile: (p: string, c: string, m: number) => void })
			.writeFile(`${FOLDER}/data.json`, `series_key: ${SERIES}\n- [ ] JSON action`, 9999);
		addNote(app, FOLDER, 'real.md', `series_key: ${SERIES}\n- [ ] MD action`, 1000);
		const svc = new ActionAggregationService(app);
		const result = await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		expect(result.scanned).toBe(1);
		expect(result.actions).not.toContain('JSON action');
	});

	it('aggregates actions from multiple notes (no duplicates)', async () => {
		const app = makeApp();
		addNote(app, FOLDER, 'p1.md', `series_key: ${SERIES}\n- [ ] Alpha\n- [ ] Beta`, 1000);
		addNote(app, FOLDER, 'p2.md', `series_key: ${SERIES}\n- [ ] Gamma\n- [ ] Beta`, 2000);
		const svc = new ActionAggregationService(app);
		const result = await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER, maxLookback: 5 });
		expect(result.actions).toContain('Alpha');
		expect(result.actions).toContain('Beta');
		expect(result.actions).toContain('Gamma');
		// Beta appears only once
		expect(result.actions.filter(a => a.toLowerCase() === 'beta')).toHaveLength(1);
	});
	it('corrupted note with nested CB markers produces clean aggregation result', async () => {
		const app = makeApp();
		// A note whose CB_ACTIONS slot was corrupted by a previous bug (nested markers)
		const corruptedContent = [
			`series_key: ${SERIES}`,
			'<!-- CB:BEGIN CB_ACTIONS -->',
			'<!-- CB:BEGIN CB_ACTIONS -->',
			'- [ ] Actual task',
			'<!-- CB:END CB_ACTIONS -->',
			'<!-- CB:END CB_ACTIONS -->',
		].join('\n');
		addNote(app, FOLDER, 'corrupted.md', corruptedContent, 1000);
		const svc = new ActionAggregationService(app);
		const result = await svc.aggregateActions({ seriesKey: SERIES, notesFolder: FOLDER });
		// Content must be clean markdown — no CB markers propagated
		expect(result.content).not.toContain('<!--');
		expect(result.content).not.toContain('CB:BEGIN');
		expect(result.content).not.toContain('CB:END');
		// The actual task should survive
		expect(result.content).toContain('Actual task');
		// Formatted as a proper checkbox
		expect(result.content).toMatch(/- \[ \] Actual task/);
	});
});
