import { App, Modal, Setting, TFile } from 'obsidian';
import { deleteNotes, DraftNoteResult } from '../services/CleanupService';

export class CleanupModal extends Modal {
	private seriesName: string;
	private result: DraftNoteResult;
	private onDone: (deleted: number) => void;

	constructor(
		app: App,
		seriesName: string,
		result: DraftNoteResult,
		onDone: (deleted: number) => void,
	) {
		super(app);
		this.seriesName = seriesName;
		this.result = result;
		this.onDone = onDone;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Clean up draft notes?' });
		contentEl.createEl('p', {
			text: `Series "${this.seriesName}" was disabled. The following draft meeting notes have no user content and can be deleted.`,
		});

		if (this.result.deletable.length === 0 && this.result.skipped.length === 0) {
			contentEl.createEl('p', { text: 'No draft notes found for this series.' });
			new Setting(contentEl).addButton(btn =>
				btn.setButtonText('Close').onClick(() => this.close()),
			);
			return;
		}

		if (this.result.deletable.length > 0) {
			contentEl.createEl('h3', { text: `Delete (${this.result.deletable.length})` });
			const list = contentEl.createEl('ul');
			for (const file of this.result.deletable) {
				list.createEl('li').createEl('code', { text: file.path });
			}
		}

		if (this.result.skipped.length > 0) {
			const details = contentEl.createEl('details');
			details.createEl('summary', {
				text: `Kept — has user content (${this.result.skipped.length})`,
			});
			const skipList = details.createEl('ul');
			for (const file of this.result.skipped) {
				skipList.createEl('li').createEl('code', { text: file.path });
			}
		}

		const btnRow = new Setting(contentEl);

		if (this.result.deletable.length > 0) {
			btnRow.addButton(btn =>
				btn
					.setButtonText(`Delete ${this.result.deletable.length} note${this.result.deletable.length !== 1 ? 's' : ''}`)
					.setWarning()
					.onClick(async () => {
						btn.setDisabled(true).setButtonText('Deleting…');
						const deleted = await deleteNotes(this.app, this.result.deletable);
						this.onDone(deleted);
						this.close();
					}),
			);
		}

		btnRow.addButton(btn =>
			btn.setButtonText('Skip').onClick(() => {
				this.onDone(0);
				this.close();
			}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
