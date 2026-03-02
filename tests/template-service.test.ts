import {
	CB_SLOTS,
	CbSlot,
	cbBegin,
	cbEnd,
	wrapSlot,
	parseSlots,
	injectBlocks,
	extractSlotContent,
} from '../src/services/TemplateService';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeTemplate(slots: CbSlot[]): string {
	return slots.map(s => `{{${s}}}`).join('\n\n');
}

// ─── cbBegin / cbEnd / wrapSlot ──────────────────────────────────────────

describe('cbBegin / cbEnd', () => {
	it('produces correct begin marker', () => {
		expect(cbBegin('CB_CONTEXT')).toBe('<!-- CB:BEGIN CB_CONTEXT -->');
	});

	it('produces correct end marker', () => {
		expect(cbEnd('CB_CONTEXT')).toBe('<!-- CB:END CB_CONTEXT -->');
	});

	it('wrapSlot wraps content between markers', () => {
		const result = wrapSlot('CB_BODY', 'hello');
		expect(result).toBe('<!-- CB:BEGIN CB_BODY -->\nhello\n<!-- CB:END CB_BODY -->');
	});
});

// ─── wrapSlot idempotency ────────────────────────────────────────────────────

describe('wrapSlot — nested marker prevention', () => {
	it('does not nest markers when body already contains a CB wrapper for the same slot', () => {
		// Simulate upstream passing pre-wrapped content
		const preWrapped = '<!-- CB:BEGIN CB_ACTIONS -->\n- [ ] Task\n<!-- CB:END CB_ACTIONS -->';
		const result = wrapSlot('CB_ACTIONS', preWrapped);
		const beginCount = (result.match(/<!-- CB:BEGIN CB_ACTIONS -->/g) ?? []).length;
		const endCount   = (result.match(/<!-- CB:END CB_ACTIONS -->/g) ?? []).length;
		expect(beginCount).toBe(1);
		expect(endCount).toBe(1);
		// Inner content is preserved
		expect(result).toContain('- [ ] Task');
	});

	it('second call to wrapSlot on already-wrapped output still produces one wrapper pair', () => {
		const once = wrapSlot('CB_ACTIONS', '- [ ] Task');
		const twice = wrapSlot('CB_ACTIONS', once);
		const beginCount = (twice.match(/<!-- CB:BEGIN CB_ACTIONS -->/g) ?? []).length;
		expect(beginCount).toBe(1);
	});

	it('does not strip wrappers for a different slot', () => {
		// CB_BODY wrapper in body should be left alone when wrapping CB_ACTIONS
		const body = '<!-- CB:BEGIN CB_BODY -->\nsome body\n<!-- CB:END CB_BODY -->';
		const result = wrapSlot('CB_ACTIONS', body);
		expect(result).toContain('<!-- CB:BEGIN CB_BODY -->');
		expect(result).toContain('<!-- CB:BEGIN CB_ACTIONS -->');
	});

	it('CB_FM is never wrapped in HTML markers even if called twice', () => {
		const once = wrapSlot('CB_FM', 'type: meeting');
		expect(once).not.toContain('<!--');
		const twice = wrapSlot('CB_FM', once);
		expect(twice).not.toContain('<!--');
	});
});

// ─── parseSlots ───────────────────────────────────────────────────────────

describe('parseSlots', () => {
	it('finds all slots present in a template', () => {
		const template = '{{CB_FM}}\n{{CB_HEADER}}\n{{CB_LINKS}}';
		const { found, missing } = parseSlots(template);
		expect(found).toEqual(['CB_FM', 'CB_HEADER', 'CB_LINKS']);
		expect(missing).toContain('CB_CONTEXT');
		expect(missing).not.toContain('CB_FM');
	});

	it('returns empty found when no slots present', () => {
		const { found, missing } = parseSlots('# Meeting\n\nNo slots here.');
		expect(found).toHaveLength(0);
		expect(missing).toEqual([...CB_SLOTS]);
	});

	it('finds all 10 slots in a full template', () => {
		const template = CB_SLOTS.map(s => `{{${s}}}`).join('\n');
		const { found, missing } = parseSlots(template);
		expect(found).toHaveLength(10);
		expect(missing).toHaveLength(0);
	});

	it('does not report partial token matches', () => {
		const { found } = parseSlots('{{CB_FM_EXTRA}}');
		expect(found).not.toContain('CB_FM');
	});
});

// ─── injectBlocks — Mode 1: token replacement ────────────────────────────

describe('injectBlocks — token replacement', () => {
	it('replaces a {{CB_HEADER}} token with wrapped block', () => {
		const template = '# {{CB_HEADER}}\n\n## Notes';
		const result = injectBlocks(template, { CB_HEADER: 'My Meeting' });
		expect(result).toContain('<!-- CB:BEGIN CB_HEADER -->');
		expect(result).toContain('My Meeting');
		expect(result).toContain('<!-- CB:END CB_HEADER -->');
		expect(result).toContain('## Notes');
	});

	it('replaces multiple slot tokens independently', () => {
		const template = makeTemplate(['CB_FM', 'CB_CONTEXT', 'CB_FOOTER']);
		const result = injectBlocks(template, {
			CB_FM: 'frontmatter',
			CB_CONTEXT: 'context content',
			CB_FOOTER: 'footer content',
		});
		// CB_FM: no HTML markers — pure fenced YAML
		expect(result).not.toContain('<!-- CB:BEGIN CB_FM -->');
		expect(result).toContain('---');
		expect(result).toContain('frontmatter');
		// Other slots: still have HTML markers
		expect(result).toContain('<!-- CB:BEGIN CB_CONTEXT -->');
		expect(result).toContain('context content');
		expect(result).toContain('<!-- CB:BEGIN CB_FOOTER -->');
		expect(result).toContain('footer content');
	});

	it('leaves unreferenced blocks undefined (no slot token, no existing block)', () => {
		const template = '{{CB_FM}}\n## Notes';
		const result = injectBlocks(template, { CB_FM: 'fm', CB_CONTEXT: 'ctx' });
		// CB_CONTEXT has no token in template and no existing block — should be absent
		expect(result).not.toContain('CB_CONTEXT');
	});

	it('replaces all occurrences of a repeated token', () => {
		const template = '{{CB_HEADER}}\n\nRepeat: {{CB_HEADER}}';
		const result = injectBlocks(template, { CB_HEADER: 'H' });
		const count = (result.match(/CB:BEGIN CB_HEADER/g) ?? []).length;
		expect(count).toBe(2);
	});
});

// ─── injectBlocks — Mode 2: idempotent block update ──────────────────────

describe('injectBlocks — idempotent block update', () => {
	it('replaces existing CB block content on re-injection', () => {
		const first = injectBlocks('{{CB_CONTEXT}}', { CB_CONTEXT: 'initial content' });
		const second = injectBlocks(first, { CB_CONTEXT: 'updated content' });
		expect(second).toContain('updated content');
		expect(second).not.toContain('initial content');
	});

	it('preserves user content outside the block', () => {
		const note =
			'## Pre-existing notes\n\n' +
			'<!-- CB:BEGIN CB_LINKS -->\nold links\n<!-- CB:END CB_LINKS -->\n\n' +
			'## My Notes\n\n- bullet';
		const result = injectBlocks(note, { CB_LINKS: 'new links' });
		expect(result).toContain('## Pre-existing notes');
		expect(result).toContain('## My Notes');
		expect(result).toContain('- bullet');
		expect(result).toContain('new links');
		expect(result).not.toContain('old links');
	});

	it('handles whitespace variations in CB markers', () => {
		const note =
			'<!--  CB:BEGIN  CB_ACTIONS  -->\nold actions\n<!--  CB:END  CB_ACTIONS  -->';
		const result = injectBlocks(note, { CB_ACTIONS: 'new actions' });
		expect(result).toContain('new actions');
		expect(result).not.toContain('old actions');
	});

	it('is truly idempotent — injecting same content twice yields same result', () => {
		const base = '{{CB_DECISIONS}}';
		const once = injectBlocks(base, { CB_DECISIONS: 'decision A' });
		const twice = injectBlocks(once, { CB_DECISIONS: 'decision A' });
		expect(once).toBe(twice);
	});

	it('updates only the targeted slot, leaving other blocks intact', () => {
		const note =
			'<!-- CB:BEGIN CB_HEADER -->\nHeader v1\n<!-- CB:END CB_HEADER -->\n' +
			'<!-- CB:BEGIN CB_FOOTER -->\nFooter v1\n<!-- CB:END CB_FOOTER -->';
		const result = injectBlocks(note, { CB_HEADER: 'Header v2' });
		expect(result).toContain('Header v2');
		expect(result).not.toContain('Header v1');
		expect(result).toContain('Footer v1'); // untouched
	});
});

// ─── injectBlocks — CB_DIAGNOSTICS debug append ──────────────────────────

describe('injectBlocks — CB_DIAGNOSTICS special case', () => {
	it('appends diagnostics block when debugEnabled and no slot or block exists', () => {
		const note = '## Notes\n\nSome content.';
		const result = injectBlocks(
			note,
			{ CB_DIAGNOSTICS: 'debug info' },
			{ debugEnabled: true },
		);
		expect(result).toContain('<!-- CB:BEGIN CB_DIAGNOSTICS -->');
		expect(result).toContain('debug info');
	});

	it('does NOT append diagnostics block when debugEnabled=false', () => {
		const note = '## Notes\n\nSome content.';
		const result = injectBlocks(
			note,
			{ CB_DIAGNOSTICS: 'debug info' },
			{ debugEnabled: false },
		);
		expect(result).not.toContain('CB_DIAGNOSTICS');
	});

	it('does NOT append diagnostics when not provided even with debugEnabled', () => {
		const note = '## Notes\n\nSome content.';
		const result = injectBlocks(note, {}, { debugEnabled: true });
		expect(result).not.toContain('CB_DIAGNOSTICS');
	});

	it('replaces existing diagnostics block even without debugEnabled', () => {
		const note =
			'<!-- CB:BEGIN CB_DIAGNOSTICS -->\nold\n<!-- CB:END CB_DIAGNOSTICS -->';
		const result = injectBlocks(note, { CB_DIAGNOSTICS: 'new' });
		expect(result).toContain('new');
		expect(result).not.toContain('old');
	});
});

// ─── extractSlotContent ───────────────────────────────────────────────────

describe('extractSlotContent', () => {
	it('extracts content from a CB block', () => {
		const note =
			'## Section\n\n<!-- CB:BEGIN CB_CONTEXT -->\nextracted\n<!-- CB:END CB_CONTEXT -->';
		expect(extractSlotContent(note, 'CB_CONTEXT')).toBe('extracted');
	});

	it('returns undefined when block absent', () => {
		expect(extractSlotContent('## No blocks here', 'CB_CONTEXT')).toBeUndefined();
	});

	it('extracts multi-line content', () => {
		const body = 'Line 1\nLine 2\nLine 3';
		const note = `<!-- CB:BEGIN CB_BODY -->\n${body}\n<!-- CB:END CB_BODY -->`;
		expect(extractSlotContent(note, 'CB_BODY')).toBe(body);
	});

	it('strips surrounding newlines but preserves inner newlines', () => {
		const note = '<!-- CB:BEGIN CB_ACTIONS -->\n- [ ] Task 1\n- [ ] Task 2\n<!-- CB:END CB_ACTIONS -->';
		const content = extractSlotContent(note, 'CB_ACTIONS');
		expect(content).toBe('- [ ] Task 1\n- [ ] Task 2');
	});
});

// ─── Round-trip ───────────────────────────────────────────────────────────

describe('round-trip: template → first inject → update', () => {
	it('preserves all user content across two inject cycles', () => {
		const template =
			'{{CB_FM}}\n# Title\n\n{{CB_HEADER}}\n\n## My Notes\n\n- user note\n\n{{CB_FOOTER}}';

		const afterFirst = injectBlocks(template, {
			CB_FM: 'type: meeting',
			CB_HEADER: 'Initial header',
			CB_FOOTER: 'Initial footer',
		});

		// Simulate user adding content between syncs
		const withUserEdits = afterFirst + '\n\n## Action Items\n\n- [ ] Follow up';

		const afterSecond = injectBlocks(withUserEdits, {
			CB_FM: 'type: meeting',
			CB_HEADER: 'Updated header',
			CB_FOOTER: 'Updated footer',
		});

		expect(afterSecond).toContain('Updated header');
		expect(afterSecond).toContain('Updated footer');
		expect(afterSecond).not.toContain('Initial header');
		expect(afterSecond).not.toContain('Initial footer');
		// User content preserved
		expect(afterSecond).toContain('## My Notes');
		expect(afterSecond).toContain('- user note');
		expect(afterSecond).toContain('## Action Items');
		expect(afterSecond).toContain('- [ ] Follow up');
	});
});

// ─── CB_FM special-case behaviour ──────────────────────────────────────

describe('CB_FM — frontmatter injection', () => {
	it('wrapSlot(CB_FM) returns fenced YAML without HTML markers', () => {
		const result = wrapSlot('CB_FM', 'type: meeting\ntitle: "Test"');
		expect(result).toBe('---\ntype: meeting\ntitle: "Test"\n---');
		expect(result).not.toContain('<!-- CB:BEGIN');
		expect(result).not.toContain('<!-- CB:END');
	});

	it('injecting CB_FM produces output starting with ---', () => {
		const template = '{{CB_FM}}\n\n# Meeting';
		const result = injectBlocks(template, { CB_FM: 'type: meeting\ntitle: "T"' });
		expect(result.startsWith('---\n')).toBe(true);
	});

	it('other slots still get HTML markers when CB_FM is also injected', () => {
		const template = '{{CB_FM}}\n\n{{CB_HEADER}}\n\n{{CB_FOOTER}}';
		const result = injectBlocks(template, {
			CB_FM: 'type: meeting',
			CB_HEADER: 'header content',
			CB_FOOTER: 'footer content',
		});
		expect(result.startsWith('---\n')).toBe(true);
		expect(result).toContain('<!-- CB:BEGIN CB_HEADER -->');
		expect(result).toContain('<!-- CB:BEGIN CB_FOOTER -->');
		expect(result).not.toContain('<!-- CB:BEGIN CB_FM -->');
	});

	it('second injection replaces existing frontmatter idempotently', () => {
		const template = '{{CB_FM}}\n\n# Meeting\n\n{{CB_HEADER}}';
		const first = injectBlocks(template, { CB_FM: 'type: meeting\ndraft: true', CB_HEADER: 'H1' });
		// Second inject with updated FM
		const second = injectBlocks(first, { CB_FM: 'type: meeting\ndraft: false', CB_HEADER: 'H2' });
		expect(second.startsWith('---\n')).toBe(true);
		expect(second).toContain('draft: false');
		expect(second).not.toContain('draft: true');
		// No duplicate frontmatter
		const fmMatches = second.match(/^---/gm) ?? [];
		expect(fmMatches).toHaveLength(2); // opening --- and closing ---
	});

	it('same FM injected twice yields identical result (idempotent)', () => {
		const template = '{{CB_FM}}\n\n## Notes';
		const once = injectBlocks(template, { CB_FM: 'type: meeting' });
		const twice = injectBlocks(once, { CB_FM: 'type: meeting' });
		expect(once).toBe(twice);
	});

	it('no {{CB_FM}} token remains after injection', () => {
		const template = '{{CB_FM}}\n\n# Title';
		const result = injectBlocks(template, { CB_FM: 'type: meeting' });
		expect(result).not.toContain('{{CB_FM}}');
	});
});

// ─── injectBlocks — nested marker prevention (integration) ────────────────────

describe('injectBlocks — nested marker prevention', () => {
	it('double injection produces exactly one CB:BEGIN/END pair per slot', () => {
		const template = '{{CB_ACTIONS}}';
		const once = injectBlocks(template, { CB_ACTIONS: '- [ ] Task' });
		const twice = injectBlocks(once, { CB_ACTIONS: '- [ ] Task' });
		const beginCount = (twice.match(/<!-- CB:BEGIN CB_ACTIONS -->/g) ?? []).length;
		const endCount   = (twice.match(/<!-- CB:END CB_ACTIONS -->/g) ?? []).length;
		expect(beginCount).toBe(1);
		expect(endCount).toBe(1);
	});

	it('injecting into a note that already has corrupted nested markers produces clean output', () => {
		// Simulate a note with nested markers from a previous bug
		const corrupted = [
			'<!-- CB:BEGIN CB_ACTIONS -->',
			'<!-- CB:BEGIN CB_ACTIONS -->',
			'- [ ] Old task',
			'<!-- CB:END CB_ACTIONS -->',
			'<!-- CB:END CB_ACTIONS -->',
		].join('\n');
		const result = injectBlocks(corrupted, { CB_ACTIONS: '- [ ] New task' });
		const beginCount = (result.match(/<!-- CB:BEGIN CB_ACTIONS -->/g) ?? []).length;
		const endCount   = (result.match(/<!-- CB:END CB_ACTIONS -->/g) ?? []).length;
		expect(beginCount).toBe(1);
		expect(endCount).toBe(1);
		expect(result).toContain('New task');
		expect(result).not.toContain('Old task');
	});
});

