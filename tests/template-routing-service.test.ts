import { resolveTemplatePath, TemplateRoute, RouteContext } from '../src/services/TemplateRoutingService';
import { NormalizedEvent, SeriesProfile } from '../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
	const start = new Date('2026-03-01T10:00:00Z');
	const end = new Date('2026-03-01T11:00:00Z');
	return {
		source: 'gcal_api',
		calendarId: 'cal-001',
		eventId: 'evt-001',
		uid: 'evt-001@google.com',
		title: 'Team Standup',
		start: start.toISOString(),
		end: end.toISOString(),
		startDate: start,
		endDate: end,
		isAllDay: false,
		status: 'confirmed',
		seriesKey: 'gcal:evt-001',
		isRecurring: true,
		sourceName: 'Work',
		...overrides,
	};
}

function makeProfile(overrides: Partial<SeriesProfile> = {}): SeriesProfile {
	return {
		seriesKey: 'gcal:evt-001',
		seriesName: 'Team Standup',
		enabled: true,
		...overrides,
	};
}

function makeRoute(overrides: Partial<TemplateRoute> = {}): TemplateRoute {
	return {
		id: 'route-1',
		templatePath: 'Templates/meeting.md',
		...overrides,
	};
}

// ─── 1. Series override (highest priority) ────────────────────────────────

describe('resolveTemplatePath — series override', () => {
	it('returns series templateOverride when present', () => {
		const ctx: RouteContext = {
			event: makeEvent(),
			profile: makeProfile({ templateOverride: 'Templates/standup.md' }),
			routes: [makeRoute({ calendarId: 'cal-001', templatePath: 'Templates/calendar.md' })],
			defaultTemplatePath: 'Templates/default.md',
		};
		const result = resolveTemplatePath(ctx);
		expect(result.templatePath).toBe('Templates/standup.md');
		expect(result.reason).toBe('series-override');
	});

	it('skips series override when templateOverride is empty string', () => {
		const ctx: RouteContext = {
			event: makeEvent(),
			profile: makeProfile({ templateOverride: '' }),
			defaultTemplatePath: 'Templates/default.md',
		};
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('default');
	});
});

// ─── 2. Calendar ID match ─────────────────────────────────────────────────

describe('resolveTemplatePath — calendar match', () => {
	it('matches by calendarId', () => {
		const ctx: RouteContext = {
			event: makeEvent({ calendarId: 'work-cal' }),
			routes: [makeRoute({ calendarId: 'work-cal', templatePath: 'Templates/work.md' })],
		};
		const result = resolveTemplatePath(ctx);
		expect(result.templatePath).toBe('Templates/work.md');
		expect(result.reason).toBe('calendar-match');
		expect(result.matchedRouteId).toBe('route-1');
	});

	it('does not match when calendarId differs', () => {
		const ctx: RouteContext = {
			event: makeEvent({ calendarId: 'other-cal' }),
			routes: [makeRoute({ calendarId: 'work-cal', templatePath: 'Templates/work.md' })],
		};
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('built-in');
	});

	it('skips route with empty templatePath', () => {
		const ctx: RouteContext = {
			event: makeEvent({ calendarId: 'work-cal' }),
			routes: [makeRoute({ calendarId: 'work-cal', templatePath: '' })],
			defaultTemplatePath: 'Templates/default.md',
		};
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('default');
	});
});

// ─── 3. Title regex match ─────────────────────────────────────────────────

describe('resolveTemplatePath — title regex', () => {
	it('matches event title against titleRegex (case-insensitive)', () => {
		const ctx: RouteContext = {
			event: makeEvent({ title: '1:1 with Alice' }),
			routes: [makeRoute({ titleRegex: '^1:1', templatePath: 'Templates/1on1.md' })],
		};
		const result = resolveTemplatePath(ctx);
		expect(result.templatePath).toBe('Templates/1on1.md');
		expect(result.reason).toBe('title-regex');
	});

	it('is case-insensitive', () => {
		const ctx: RouteContext = {
			event: makeEvent({ title: 'WEEKLY REVIEW' }),
			routes: [makeRoute({ titleRegex: 'weekly', templatePath: 'Templates/weekly.md' })],
		};
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('title-regex');
	});

	it('skips invalid regex without throwing', () => {
		const ctx: RouteContext = {
			event: makeEvent({ title: 'Standup' }),
			routes: [makeRoute({ titleRegex: '[invalid', templatePath: 'Templates/t.md' })],
			defaultTemplatePath: 'Templates/default.md',
		};
		expect(() => resolveTemplatePath(ctx)).not.toThrow();
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('default');
	});
});

// ─── 4. Email domain match ────────────────────────────────────────────────

describe('resolveTemplatePath — domain match', () => {
	it('matches when any attendee email domain matches', () => {
		const ctx: RouteContext = {
			event: makeEvent({
				attendees: [{ email: 'alice@company.com' }, { email: 'bob@other.com' }],
			}),
			routes: [makeRoute({ domain: 'company.com', templatePath: 'Templates/company.md' })],
		};
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('domain-match');
		expect(result.templatePath).toBe('Templates/company.md');
	});

	it('is case-insensitive for domain', () => {
		const ctx: RouteContext = {
			event: makeEvent({ attendees: [{ email: 'user@COMPANY.COM' }] }),
			routes: [makeRoute({ domain: 'company.com', templatePath: 'Templates/company.md' })],
		};
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('domain-match');
	});

	it('does not match when no attendees present', () => {
		const ctx: RouteContext = {
			event: makeEvent({ attendees: [] }),
			routes: [makeRoute({ domain: 'company.com', templatePath: 'Templates/company.md' })],
			defaultTemplatePath: 'Templates/default.md',
		};
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('default');
	});
});

// ─── 5. Default ───────────────────────────────────────────────────────────

describe('resolveTemplatePath — default', () => {
	it('falls back to defaultTemplatePath when no routes match', () => {
		const ctx: RouteContext = {
			event: makeEvent(),
			routes: [],
			defaultTemplatePath: 'Templates/default.md',
		};
		const result = resolveTemplatePath(ctx);
		expect(result.templatePath).toBe('Templates/default.md');
		expect(result.reason).toBe('default');
	});
});

// ─── 6. Built-in fallback ─────────────────────────────────────────────────

describe('resolveTemplatePath — built-in fallback', () => {
	it('returns empty string with built-in reason when nothing matches', () => {
		const ctx: RouteContext = {
			event: makeEvent(),
			routes: [],
		};
		const result = resolveTemplatePath(ctx);
		expect(result.templatePath).toBe('');
		expect(result.reason).toBe('built-in');
	});

	it('returns built-in when defaultTemplatePath is empty string', () => {
		const ctx: RouteContext = {
			event: makeEvent(),
			defaultTemplatePath: '',
		};
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('built-in');
	});
});

// ─── Priority order ───────────────────────────────────────────────────────

describe('resolveTemplatePath — priority order', () => {
	it('series override beats calendar match', () => {
		const ctx: RouteContext = {
			event: makeEvent({ calendarId: 'work-cal' }),
			profile: makeProfile({ templateOverride: 'Templates/series.md' }),
			routes: [makeRoute({ calendarId: 'work-cal', templatePath: 'Templates/calendar.md' })],
		};
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('series-override');
	});

	it('calendar match beats title regex', () => {
		const ctx: RouteContext = {
			event: makeEvent({ calendarId: 'work-cal', title: 'Standup' }),
			routes: [
				makeRoute({ id: 'cal-route', calendarId: 'work-cal', templatePath: 'Templates/cal.md' }),
				makeRoute({ id: 'title-route', titleRegex: 'standup', templatePath: 'Templates/title.md' }),
			],
		};
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('calendar-match');
		expect(result.matchedRouteId).toBe('cal-route');
	});

	it('title regex beats domain match in route order', () => {
		// Both on same route — title regex is checked before domain in the loop
		const ctx: RouteContext = {
			event: makeEvent({
				title: 'Standup',
				attendees: [{ email: 'user@company.com' }],
			}),
			routes: [
				makeRoute({ id: 'title-route', titleRegex: 'standup', templatePath: 'Templates/title.md' }),
				makeRoute({ id: 'domain-route', domain: 'company.com', templatePath: 'Templates/domain.md' }),
			],
		};
		const result = resolveTemplatePath(ctx);
		expect(result.matchedRouteId).toBe('title-route');
	});

	it('default beats built-in', () => {
		const ctx: RouteContext = {
			event: makeEvent(),
			defaultTemplatePath: 'Templates/default.md',
		};
		const result = resolveTemplatePath(ctx);
		expect(result.reason).toBe('default');
	});
});
