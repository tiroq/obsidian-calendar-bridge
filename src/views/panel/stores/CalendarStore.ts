/**
 * CalendarStore — caches RichCalendarItem[] from the Google Calendar API.
 * Provides refresh() and subscribe/unsubscribe for panel sections.
 */

import { RichCalendarItem } from '../../../types';
import { GoogleCalendarAdapter } from '../../../sources/gcal-source';

export type CalendarStoreListener = (calendars: RichCalendarItem[]) => void;

export class CalendarStore {
	private calendars: RichCalendarItem[] = [];
	private listeners: Set<CalendarStoreListener> = new Set();
	private adapter: GoogleCalendarAdapter;

	constructor(adapter: GoogleCalendarAdapter) {
		this.adapter = adapter;
	}

	/** Current cached calendars (synchronous). */
	getCalendars(): RichCalendarItem[] {
		return this.calendars;
	}

	/** Fetch calendars from the API and notify listeners. */
	async refresh(): Promise<void> {
		this.calendars = await this.adapter.listCalendars();
		this.notify();
	}

	subscribe(listener: CalendarStoreListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const fn of this.listeners) {
			fn(this.calendars);
		}
	}
}
