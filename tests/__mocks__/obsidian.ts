/**
 * Minimal mock for the `obsidian` module used in Jest tests.
 *
 * Only the parts of the Obsidian API actually consumed by Calendar Bridge
 * are implemented here.
 */

// ─── TFile / TFolder ──────────────────────────────────────────────────────────

export class TFile {
	path: string;
	name: string;
	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() ?? path;
	}
}

export class TFolder {
	path: string;
	name: string;
	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() ?? path;
	}
}

// ─── Vault ────────────────────────────────────────────────────────────────────

export class Vault {
	private files = new Map<string, string>();
	private folders = new Set<string>();

	async create(path: string, data: string): Promise<TFile> {
		if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
		this.files.set(path, data);
		return new TFile(path);
	}

	async read(file: TFile): Promise<string> {
		const content = this.files.get(file.path);
		if (content === undefined) throw new Error(`File not found: ${file.path}`);
		return content;
	}

	async modify(file: TFile, data: string): Promise<void> {
		if (!this.files.has(file.path)) throw new Error(`File not found: ${file.path}`);
		this.files.set(file.path, data);
	}

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		if (this.files.has(path)) return new TFile(path);
		if (this.folders.has(path)) return new TFolder(path);
		return null;
	}

	async createFolder(path: string): Promise<TFolder> {
		this.folders.add(path);
		return new TFolder(path);
	}

	// ── Test helpers ───────────────────────────────────────────────────────────

	/** Read a file by path without needing a TFile handle (test convenience). */
	readByPath(path: string): string | undefined {
		return this.files.get(path);
	}

	/** List all file paths currently in the vault (test convenience). */
	listFiles(): string[] {
		return Array.from(this.files.keys());
	}
}

// ─── App ──────────────────────────────────────────────────────────────────────

export class App {
	vault = new Vault();
}

// ─── requestUrl ───────────────────────────────────────────────────────────────

export const requestUrl = jest.fn(async (_opts: { url: string; method: string }) => ({
	text: '',
	status: 200,
}));

// ─── Misc ─────────────────────────────────────────────────────────────────────

export class Notice {
	constructor(public message: string) {}
}

export class Plugin {
	app: App;
	constructor(app: App, _manifest: unknown) {
		this.app = app;
	}
	async loadData(): Promise<unknown> { return {}; }
	async saveData(_data: unknown): Promise<void> {}
	addCommand(_cmd: unknown): void {}
	addRibbonIcon(_icon: string, _title: string, _cb: () => void): void {}
	addSettingTab(_tab: unknown): void {}
}

export class PluginSettingTab {
	app: App;
	containerEl: HTMLElement;
	constructor(app: App, _plugin: unknown) {
		this.app = app;
		this.containerEl = document.createElement('div');
	}
	display(): void {}
}

export class Setting {
	constructor(_containerEl: HTMLElement) {}
	setName(_name: string): this { return this; }
	setDesc(_desc: string): this { return this; }
	setHeading(): this { return this; }
	addText(_cb: unknown): this { return this; }
	addToggle(_cb: unknown): this { return this; }
	addSlider(_cb: unknown): this { return this; }
	addButton(_cb: unknown): this { return this; }
	addExtraButton(_cb: unknown): this { return this; }
}
