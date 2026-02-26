# 03 — Sync Engine (Idempotent Planner)

## 1. Sync triggers
- Manual command: `Sync next N days`
- Auto (desktop): interval timer (e.g. every 60 minutes) + debounce
- On app start: optional
- On vault open: optional

## 2. Horizon
Setting: `horizonDays` (default=3)
Range:
- `timeMin = now - backfillWindow` (optional, default=0)
- `timeMax = now + horizonDays`

Backfill is needed for the "prev link" and if a meeting was rescheduled.

## 3. Idempotency
A repeated sync must:
- not create duplicates
- not break manual text
- only:
  - create missing files
  - update frontmatter
  - update AUTOGEN sections

## 4. Incrementality
Minimum v1:
- each sync reads events over the horizon.

Optional v1.1:
- `lastSyncAt` cache
- if the source supports incrementality (API sync token), use it.

## 5. Task scheduler
Requirements:
- cancel previous tasks on new run (cancelable)
- concurrency limit (1 sync at a time)
- stage logging

Pseudo-pipeline:
1) Fetch events
2) Normalize
3) Group by seriesKey
4) Filter by subscriptions
5) Render plan (what to create/update)
6) Apply plan (write files)
7) Update series pages
8) Update cross-links
9) Persist cache/state

## 6. State
Stored in the plugin data folder (not in Vault by default):
- `subscriptions.json` (seriesKey -> enabled, seriesName, overrides)
- `cache.json` (last sync, event->note path mapping, AUTOGEN block hashes)

Optional: "state-in-vault" mode (for sync between devices) — vNext.

## 7. Conflict strategy
If the user renamed/moved a file:
- plugin tries to find it by `event_id`/`ical_uid` in frontmatter.
- if found — updates the existing file.
- if not found — creates a new one (and warns the user).

## 8. Handling cancellations/reschedules
- cancelled event:
  - do not delete the note automatically
  - update `status: cancelled`
  - add a "Cancelled" marker in AUTOGEN:LINKS
- rescheduled:
  - update start/end
  - suggest moving the file to the new date folder (if enabled).

## 9. Limits and degradation
- If the API does not return attendees — the joiners section is filled with an empty template.
- If there is no conferenceUrl — the field is hidden or left blank.
