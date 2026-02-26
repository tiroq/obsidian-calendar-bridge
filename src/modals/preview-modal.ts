/**
 * Preview Sync Plan Modal for Calendar Bridge.
 *
 * Shows the user exactly which files will be created or updated
 * before committing any writes to the vault.
 *
 * Renders:
 *   - Files to CREATE (with reason: new event)
 *   - Files to UPDATE (with reason: AUTOGEN refresh / status change)
 *   - Files to SKIP (no changes)
 *
 * "Apply" button executes the plan.
 */

import { App, Modal, Setting } from 'obsidian';

export interface SyncPlanItem {
	action: 'create' | 'update' | 'skip';
	path: string;
	reason: string;
}

export interface SyncPlan {
	items: SyncPlanItem[];
	errors: string[];
}

/** Minimal plugin interface needed by this modal. */
export interface PreviewModalPlugin {
	/** Execute the already-computed plan and write files. */
	applyPlan(plan: SyncPlan): Promise<{ created: number; updated: number; errors: string[] }>;
}

export class PreviewModal extends Modal {
	private plan: SyncPlan;
	private plugin: PreviewModalPlugin;

	constructor(app: App, plugin: PreviewModalPlugin, plan: SyncPlan) {
		super(app);
		this.plugin = plugin;
		this.plan   = plan;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('calendar-bridge-preview-modal');

		contentEl.createEl('h2', { text: 'Sync Preview' });

		if (this.plan.errors.length > 0) {
			const errEl = contentEl.createEl('div', { cls: 'calendar-bridge-errors' });
			errEl.createEl('p', { text: `⚠ ${this.plan.errors.length} error(s) during plan:` });
			const ul = errEl.createEl('ul');
			for (const err of this.plan.errors) {
				ul.createEl('li', { text: err });
			}
		}

		const creates = this.plan.items.filter(i => i.action === 'create');
		const updates = this.plan.items.filter(i => i.action === 'update');
		const skips   = this.plan.items.filter(i => i.action === 'skip');

		this.renderGroup(contentEl, `Create (${creates.length})`, creates, 'create');
		this.renderGroup(contentEl, `Update (${updates.length})`, updates, 'update');

		if (skips.length > 0) {
			const details = contentEl.createEl('details');
			details.createEl('summary', { text: `Skip (${skips.length}) — no changes` });
			const list = details.createEl('ul', { cls: 'calendar-bridge-skip-list' });
			for (const item of skips) {
				list.createEl('li', { text: item.path, cls: 'calendar-bridge-skip' });
			}
		}

		if (creates.length === 0 && updates.length === 0) {
			contentEl.createEl('p', {
				text: 'Nothing to do — all notes are up to date.',
				cls: 'calendar-bridge-nothing',
			});
		}

		// ── Action buttons ────────────────────────────────────────────────────
		const btnRow = new Setting(contentEl);

		if (creates.length > 0 || updates.length > 0) {
			btnRow.addButton(btn =>
				btn
					.setButtonText(`Apply (${creates.length + updates.length} changes)`)
					.setCta()
					.onClick(async () => {
						btn.setDisabled(true).setButtonText('Applying…');
						try {
							const res = await this.plugin.applyPlan(this.plan);
							contentEl.empty();
							contentEl.createEl('h2', { text: 'Done' });
							contentEl.createEl('p', {
								text: `Created: ${res.created}  Updated: ${res.updated}` +
									(res.errors.length > 0 ? `  Errors: ${res.errors.length}` : ''),
							});
							new Setting(contentEl).addButton(b =>
								b.setButtonText('Close').onClick(() => this.close()),
							);
						} catch (err) {
							btn.setDisabled(false).setButtonText('Apply failed — retry');
							contentEl.createEl('p', {
								text: `Error: ${(err as Error).message}`,
								cls: 'calendar-bridge-error',
							});
						}
					}),
			);
		}

		btnRow.addButton(btn =>
			btn.setButtonText('Close').onClick(() => this.close()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderGroup(
		containerEl: HTMLElement,
		heading: string,
		items: SyncPlanItem[],
		cls: string,
	): void {
		if (items.length === 0) return;

		containerEl.createEl('h3', { text: heading });
		const list = containerEl.createEl('ul', { cls: `calendar-bridge-plan-${cls}` });
		for (const item of items) {
			const li = list.createEl('li');
			li.createEl('code', { text: item.path });
			li.createSpan({ text: ` — ${item.reason}` });
		}
	}
}
