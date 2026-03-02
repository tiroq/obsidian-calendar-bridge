import { App } from './__mocks__/obsidian';
import { resolveSeriesTemplate, applySeriesVariables } from '../src/utils/TemplateResolver';
import { ensureSeriesBlocksExist, DEFAULT_SERIES_TEMPLATE, REQUIRED_SERIES_BLOCKS } from '../src/utils/SeriesTemplate';
import { DEFAULT_SETTINGS } from '../src/types';

type MockVault = {
	writeFile: (path: string, content: string, mtime?: number) => void;
	readByPath: (path: string) => string | undefined;
};
const mockVault = (app: App) => app.vault as unknown as MockVault;

describe('resolveSeriesTemplate', () => {
	it('returns DEFAULT_SERIES_TEMPLATE when seriesTemplatePath is empty', async () => {
		const app = new App();
		const settings = { ...DEFAULT_SETTINGS, seriesTemplatePath: '' };
		const result = await resolveSeriesTemplate(app as never, settings);
		expect(result).toBe(DEFAULT_SERIES_TEMPLATE);
	});

	it('returns custom template when seriesTemplatePath points to existing file', async () => {
		const app = new App();
		const customTemplate = '# Custom\n<!-- CB:BEGIN CB_SERIES_ACTIONS -->\n<!-- CB:END CB_SERIES_ACTIONS -->';
		mockVault(app).writeFile('_templates/Series.md', customTemplate);
		const settings = { ...DEFAULT_SETTINGS, seriesTemplatePath: '_templates/Series.md' };
		const result = await resolveSeriesTemplate(app as never, settings);
		expect(result).toBe(customTemplate);
	});

	it('falls back to DEFAULT_SERIES_TEMPLATE when path set but file missing', async () => {
		const app = new App();
		const settings = { ...DEFAULT_SETTINGS, seriesTemplatePath: '_templates/Nonexistent.md' };
		const result = await resolveSeriesTemplate(app as never, settings);
		expect(result).toBe(DEFAULT_SERIES_TEMPLATE);
	});
});

describe('applySeriesVariables', () => {
	it('replaces all known placeholders', () => {
		const tpl = '# {{series_name}}\nkey: {{series_key}}\nfolder: {{meetings_folder}}\ndate: {{today}}';
		const result = applySeriesVariables(tpl, { seriesKey: 'standup', seriesName: 'Daily Standup', meetingsFolder: 'Meetings' });
		expect(result).toContain('# Daily Standup');
		expect(result).toContain('key: standup');
		expect(result).toContain('folder: Meetings');
		expect(result).toMatch(/date: \d{4}-\d{2}-\d{2}/);
	});

	it('leaves unknown placeholders untouched', () => {
		const tpl = '{{unknown_var}}';
		const result = applySeriesVariables(tpl, { seriesKey: 'k', seriesName: 'N', meetingsFolder: 'M' });
		expect(result).toBe('{{unknown_var}}');
	});
});

describe('ensureSeriesBlocksExist', () => {
	it('returns content unchanged when all blocks present', () => {
		const content = REQUIRED_SERIES_BLOCKS.map(b => `<!-- CB:BEGIN ${b} -->\n<!-- CB:END ${b} -->`).join('\n');
		const result = ensureSeriesBlocksExist(content);
		expect(result).toBe(content);
	});

	it('appends missing blocks', () => {
		const content = '<!-- CB:BEGIN CB_SERIES_ACTIONS -->\n<!-- CB:END CB_SERIES_ACTIONS -->';
		const result = ensureSeriesBlocksExist(content);
		for (const block of REQUIRED_SERIES_BLOCKS) {
			expect(result).toContain(`<!-- CB:BEGIN ${block} -->`);
		}
	});

	it('does not duplicate existing blocks', () => {
		const content = REQUIRED_SERIES_BLOCKS.map(b => `<!-- CB:BEGIN ${b} -->\n<!-- CB:END ${b} -->`).join('\n');
		const result = ensureSeriesBlocksExist(content);
		for (const block of REQUIRED_SERIES_BLOCKS) {
			const matches = (result.match(new RegExp(`<!-- CB:BEGIN ${block} -->`, 'g')) ?? []).length;
			expect(matches).toBe(1);
		}
	});
});
