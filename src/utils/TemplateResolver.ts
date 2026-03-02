import { App, TFile } from 'obsidian';
import { PluginSettings } from '../types';
import { DEFAULT_SERIES_TEMPLATE } from './SeriesTemplate';

export async function resolveSeriesTemplate(app: App, settings: PluginSettings): Promise<string> {
	if (!settings.seriesTemplatePath) {
		return DEFAULT_SERIES_TEMPLATE;
	}

	const file = app.vault.getAbstractFileByPath(settings.seriesTemplatePath);
	if (file instanceof TFile) {
		return await app.vault.read(file);
	}

	console.log('[CalendarBridge] Series template not found, using default:', settings.seriesTemplatePath);
	return DEFAULT_SERIES_TEMPLATE;
}

export function applySeriesVariables(
	template: string,
	vars: { seriesKey: string; seriesName: string; meetingsFolder: string },
): string {
	return template
		.replace(/\{\{series_key\}\}/g, vars.seriesKey)
		.replace(/\{\{series_name\}\}/g, vars.seriesName)
		.replace(/\{\{today\}\}/g, new Date().toISOString().slice(0, 10))
		.replace(/\{\{meetings_folder\}\}/g, vars.meetingsFolder);
}
