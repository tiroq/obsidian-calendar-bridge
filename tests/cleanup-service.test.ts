import { App, TFile } from './__mocks__/obsidian';
import { hasMeaningfulContent, findDraftNotesForSeries } from '../src/services/CleanupService';

type MockVault = {
	writeFile: (path: string, content: string, mtime?: number) => void;
	listFiles: () => string[];
};
const mv = (app: App) => app.vault as unknown as MockVault;

const MEETINGS_ROOT = 'Meetings';

function draftNote(seriesKey: string, extra = ''): string {
	return [
		'---',
		`series_key: ${seriesKey}`,
		'draft: true',
		'title: Team Standup',
		'---',
		'',
		'## Agenda',
		'<!-- AUTOGEN:AGENDA:START -->',
		'- Standups',
		'<!-- AUTOGEN:AGENDA:END -->',
		'',
		'## Notes',
		extra,
	].join('\n');
}

describe('hasMeaningfulContent', () => {
	it('returns false for a pure template with no user text', () => {
		const content = draftNote('gcal:abc');
		expect(hasMeaningfulContent(content)).toBe(false);
	});

	it('returns false when only headings and AUTOGEN blocks remain', () => {
		const content = [
			'---',
			'draft: true',
			'---',
			'',
			'## Notes',
			'## Decisions',
		].join('\n');
		expect(hasMeaningfulContent(content)).toBe(false);
	});

	it('returns true when user added a line under a heading', () => {
		const content = draftNote('gcal:abc', 'Some notes I actually wrote here.');
		expect(hasMeaningfulContent(content)).toBe(true);
	});

	it('returns true when user added a task outside AUTOGEN', () => {
		const content = draftNote('gcal:abc', '- [ ] Follow up with Alice');
		expect(hasMeaningfulContent(content)).toBe(true);
	});

	it('ignores content inside CB blocks', () => {
		const content = [
			'---',
			'draft: true',
			'---',
			'<!-- CB:BEGIN CB_CONTEXT -->',
			'Some CB-generated content here',
			'<!-- CB:END CB_CONTEXT -->',
		].join('\n');
		expect(hasMeaningfulContent(content)).toBe(false);
	});

	it('returns false for a blank note after stripping frontmatter', () => {
		const content = '---\ndraft: true\n---\n\n';
		expect(hasMeaningfulContent(content)).toBe(false);
	});
});

describe('findDraftNotesForSeries', () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it('returns empty result when no files match the series_key', async () => {
		mv(app).writeFile(`${MEETINGS_ROOT}/2026-01-01/note.md`, draftNote('gcal:OTHER'));
		const result = await findDraftNotesForSeries(app as never, 'gcal:TARGET', MEETINGS_ROOT);
		expect(result.deletable).toHaveLength(0);
		expect(result.skipped).toHaveLength(0);
	});

	it('places a clean draft note in deletable', async () => {
		mv(app).writeFile(`${MEETINGS_ROOT}/2026-01-01/standup.md`, draftNote('gcal:TARGET'));
		const result = await findDraftNotesForSeries(app as never, 'gcal:TARGET', MEETINGS_ROOT);
		expect(result.deletable).toHaveLength(1);
		expect(result.deletable[0].path).toBe(`${MEETINGS_ROOT}/2026-01-01/standup.md`);
		expect(result.skipped).toHaveLength(0);
	});

	it('places a draft note with user content in skipped', async () => {
		mv(app).writeFile(
			`${MEETINGS_ROOT}/2026-01-02/standup.md`,
			draftNote('gcal:TARGET', 'User wrote something here'),
		);
		const result = await findDraftNotesForSeries(app as never, 'gcal:TARGET', MEETINGS_ROOT);
		expect(result.deletable).toHaveLength(0);
		expect(result.skipped).toHaveLength(1);
	});

	it('separates multiple notes correctly', async () => {
		mv(app).writeFile(`${MEETINGS_ROOT}/2026-01-01/a.md`, draftNote('gcal:TARGET'));
		mv(app).writeFile(`${MEETINGS_ROOT}/2026-01-02/b.md`, draftNote('gcal:TARGET', 'user notes'));
		mv(app).writeFile(`${MEETINGS_ROOT}/2026-01-03/c.md`, draftNote('gcal:TARGET'));
		const result = await findDraftNotesForSeries(app as never, 'gcal:TARGET', MEETINGS_ROOT);
		expect(result.deletable).toHaveLength(2);
		expect(result.skipped).toHaveLength(1);
	});

	it('ignores notes without draft: true', async () => {
		const nonDraft = [
			'---',
			'series_key: gcal:TARGET',
			'draft: false',
			'---',
			'',
			'## Notes',
		].join('\n');
		mv(app).writeFile(`${MEETINGS_ROOT}/2026-01-01/note.md`, nonDraft);
		const result = await findDraftNotesForSeries(app as never, 'gcal:TARGET', MEETINGS_ROOT);
		expect(result.deletable).toHaveLength(0);
		expect(result.skipped).toHaveLength(0);
	});

	it('ignores files outside meetingsRoot', async () => {
		mv(app).writeFile(`OtherFolder/standup.md`, draftNote('gcal:TARGET'));
		const result = await findDraftNotesForSeries(app as never, 'gcal:TARGET', MEETINGS_ROOT);
		expect(result.deletable).toHaveLength(0);
	});

	it('ignores non-markdown files', async () => {
		mv(app).writeFile(`${MEETINGS_ROOT}/2026-01-01/attachment.pdf`, draftNote('gcal:TARGET'));
		const result = await findDraftNotesForSeries(app as never, 'gcal:TARGET', MEETINGS_ROOT);
		expect(result.deletable).toHaveLength(0);
	});

	it('returns results sorted by path', async () => {
		mv(app).writeFile(`${MEETINGS_ROOT}/2026-01-03/c.md`, draftNote('gcal:TARGET'));
		mv(app).writeFile(`${MEETINGS_ROOT}/2026-01-01/a.md`, draftNote('gcal:TARGET'));
		mv(app).writeFile(`${MEETINGS_ROOT}/2026-01-02/b.md`, draftNote('gcal:TARGET'));
		const result = await findDraftNotesForSeries(app as never, 'gcal:TARGET', MEETINGS_ROOT);
		const paths = result.deletable.map(f => f.path);
		expect(paths).toEqual([...paths].sort());
	});
});
