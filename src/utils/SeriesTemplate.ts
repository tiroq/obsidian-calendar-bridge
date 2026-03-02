import { cbBegin, cbEnd } from '../services/TemplateService';

export const DEFAULT_SERIES_TEMPLATE = `---
type: meeting_series
series_key: {{series_key}}
series_name: "{{series_name}}"
---

# {{series_name}}

> Created: {{today}}

## Open Actions

<!-- CB:BEGIN CB_SERIES_ACTIONS -->
<!-- CB:END CB_SERIES_ACTIONS -->

## Active Decisions

<!-- CB:BEGIN CB_SERIES_DECISIONS -->
<!-- CB:END CB_SERIES_DECISIONS -->

## Meetings

<!-- CB:BEGIN CB_SERIES_MEETINGS_INDEX -->
<!-- CB:END CB_SERIES_MEETINGS_INDEX -->

<!-- CB:BEGIN CB_SERIES_DIAGNOSTICS -->
<!-- CB:END CB_SERIES_DIAGNOSTICS -->

## Notes

*(Series-level notes here)*
`;

export const REQUIRED_SERIES_BLOCKS = [
	'CB_SERIES_ACTIONS',
	'CB_SERIES_DECISIONS',
	'CB_SERIES_MEETINGS_INDEX',
	'CB_SERIES_DIAGNOSTICS',
] as const;

export function ensureSeriesBlocksExist(content: string): string {
	let next = content;

	for (const block of REQUIRED_SERIES_BLOCKS) {
		const beginMarker = cbBegin(block);
		if (!next.includes(beginMarker)) {
			console.log('[CalendarBridge] Auto-appending missing series block:', block);
			next = `${next}\n${cbBegin(block)}\n${cbEnd(block)}\n`;
		}
	}

	return next;
}
