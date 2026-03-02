/**
 * decisionDates — parse an embedded date out of a decision line's text.
 *
 * Supported formats (first match wins):
 *   ISO datetime  : 2026-03-06T14:30
 *   ISO date      : 2026-03-06
 *   English long  : March 6, 2026  |  March 6 2026
 *   English short : Mar 6, 2026    |  Mar 6 2026
 *   Day-first     : 6 March 2026   |  6 Mar 2026
 */

const MONTH_MAP: Record<string, number> = {
	january: 0, jan: 0,
	february: 1, feb: 1,
	march: 2, mar: 2,
	april: 3, apr: 3,
	may: 4,
	june: 5, jun: 5,
	july: 6, jul: 6,
	august: 7, aug: 7,
	september: 8, sep: 8, sept: 8,
	october: 9, oct: 9,
	november: 10, nov: 10,
	december: 11, dec: 11,
};

/**
 * Try to parse an embedded date from the given text.
 * Returns a Date at midnight local time, or null if no date found.
 */
export function parseEmbeddedDate(text: string): Date | null {
	// 1. ISO datetime: 2026-03-06T14:30 (or T14:30:00)
	const isoDatetime = /\b(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}/.exec(text);
	if (isoDatetime) {
		const d = new Date(isoDatetime[0]);
		if (!isNaN(d.getTime())) return midnight(d);
	}

	// 2. ISO date: 2026-03-06
	const isoDate = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
	if (isoDate) {
		const d = parseYmd(
			parseInt(isoDate[1], 10),
			parseInt(isoDate[2], 10) - 1,
			parseInt(isoDate[3], 10),
		);
		if (d) return d;
	}

	// 3. Month-first English: March 6, 2026  /  Mar 6 2026
	const monthFirst = /\b([A-Za-z]+)\s+(\d{1,2})[,\s]+(\d{4})\b/.exec(text);
	if (monthFirst) {
		const mo = MONTH_MAP[monthFirst[1].toLowerCase()];
		if (mo !== undefined) {
			const d = parseYmd(parseInt(monthFirst[3], 10), mo, parseInt(monthFirst[2], 10));
			if (d) return d;
		}
	}

	// 4. Day-first English: 6 March 2026  /  6 Mar 2026
	const dayFirst = /\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/.exec(text);
	if (dayFirst) {
		const mo = MONTH_MAP[dayFirst[2].toLowerCase()];
		if (mo !== undefined) {
			const d = parseYmd(parseInt(dayFirst[3], 10), mo, parseInt(dayFirst[1], 10));
			if (d) return d;
		}
	}

	return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseYmd(year: number, month0: number, day: number): Date | null {
	if (month0 < 0 || month0 > 11) return null;
	if (day < 1 || day > 31) return null;
	const d = new Date(year, month0, day);
	// Guard against JS date overflow (e.g. Feb 30 → March 2)
	if (d.getFullYear() !== year || d.getMonth() !== month0 || d.getDate() !== day) return null;
	return d;
}

function midnight(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
