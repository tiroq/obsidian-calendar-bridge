# 11 — Edge Cases & Failure Modes

## 1. Timezones / DST
- event in a TZ different from the system TZ
- DST transition
- all-day events (start.date instead of start.dateTime in the API; same in ICS)

## 2. Recurring exceptions
- individual instance rescheduled/modified
- instance cancelled
- series ended, but old notes remain

## 3. Duplicates and collisions
- 2 events with the same name and time
- event renamed in the calendar
- user renames file manually
- user deletes file manually

## 4. Missing fields
- no attendees (ICS)
- no conference link
- empty description

## 5. Permissions/Policy
- corporate workspace blocks OAuth
- external apps not allowed
- solution: ICS fallback

## 6. Performance
- many calendars, many events
- limit calendar selection
- caching and conditional fetch (ICS)
