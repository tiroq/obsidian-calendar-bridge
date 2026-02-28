/**
 * TemplateRoutingService — picks the right template path for an event.
 *
 * Resolution order (first match wins):
 *   1. Series override  — profile.templateOverride
 *   2. Calendar match   — routes[].calendarId === event.calendarId
 *   3. Title regex      — routes[].titleRegex matches event.title
 *   4. Email domain     — routes[].domain matches any attendee email domain
 *   5. Default          — settings.templatePath (user's global default)
 *   6. Built-in         — empty string (caller falls back to DEFAULT_TEMPLATE)
 */

import { NormalizedEvent, SeriesProfile } from '../types';

// ─── Route rule ───────────────────────────────────────────────────────────

export interface TemplateRoute {
	/** Unique identifier for debugging. */
	id: string;
	/** Vault path to the template file. */
	templatePath: string;
	/** Match by Google Calendar ID. */
	calendarId?: string;
	/** Match by event title regex (JS-compatible string). */
	titleRegex?: string;
	/** Match by attendee email domain, e.g. "company.com". */
	domain?: string;
}

// ─── Resolution context ───────────────────────────────────────────────────

export interface RouteContext {
	event: NormalizedEvent;
	profile?: SeriesProfile;
	/** Ordered list of TemplateRoute rules (from settings). */
	routes?: TemplateRoute[];
	/** Global default template path (settings.templatePath). */
	defaultTemplatePath?: string;
}

// ─── Resolution result ────────────────────────────────────────────────────

export type RouteReason =
	| 'series-override'
	| 'calendar-match'
	| 'title-regex'
	| 'domain-match'
	| 'default'
	| 'built-in';

export interface RouteResult {
	/** Resolved vault path (empty string = use built-in DEFAULT_TEMPLATE). */
	templatePath: string;
	reason: RouteReason;
	/** The matching route id when reason is calendar-match / title-regex / domain-match. */
	matchedRouteId?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────

/**
 * Resolve the template path for an event given the routing context.
 * Pure function — no I/O.
 */
export function resolveTemplatePath(ctx: RouteContext): RouteResult {
	const { event, profile, routes = [], defaultTemplatePath = '' } = ctx;

	// 1. Series override
	if (profile?.templateOverride) {
		return {
			templatePath: profile.templateOverride,
			reason: 'series-override',
		};
	}

	// 2–4. Route rules
	for (const route of routes) {
		if (!route.templatePath) continue;

		// 2. Calendar ID match
		if (route.calendarId && route.calendarId === event.calendarId) {
			return {
				templatePath: route.templatePath,
				reason: 'calendar-match',
				matchedRouteId: route.id,
			};
		}

		// 3. Title regex match
		if (route.titleRegex) {
			try {
				const re = new RegExp(route.titleRegex, 'i');
				if (re.test(event.title)) {
					return {
						templatePath: route.templatePath,
						reason: 'title-regex',
						matchedRouteId: route.id,
					};
				}
			} catch {
				// Invalid regex — skip this route
			}
		}

		// 4. Email domain match
		if (route.domain) {
			const domain = route.domain.toLowerCase();
			const attendees = event.attendees ?? [];
			const matched = attendees.some(a => {
				const parts = a.email.split('@');
				return parts.length === 2 && parts[1].toLowerCase() === domain;
			});
			if (matched) {
				return {
					templatePath: route.templatePath,
					reason: 'domain-match',
					matchedRouteId: route.id,
				};
			}
		}
	}

	// 5. Global default
	if (defaultTemplatePath) {
		return {
			templatePath: defaultTemplatePath,
			reason: 'default',
		};
	}

	// 6. Built-in fallback
	return {
		templatePath: '',
		reason: 'built-in',
	};
}
