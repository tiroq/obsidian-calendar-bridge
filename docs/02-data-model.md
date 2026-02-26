# 02 — Data Model & Identifiers

## 1. Core principle
Calendar data is normalized into an internal `NormalizedEvent` model. The note generator then works ONLY with this model, without knowing the origin of the source.

## 2. NormalizedEvent (logical schema)
Required:
- `source` (gcal_api | ics_public | ics_secret | ...)
- `calendarId`
- `eventId` (source identifier, if available)
- `uid` (iCal UID if available)
- `title`
- `start` (ISO datetime with tz)
- `end` (ISO datetime with tz)
- `status` (confirmed | cancelled | tentative | unknown)
- `updatedAt` (if available)
- `recurrence` (object | null)
- `seriesKey` (stable series key, see below)

Optional:
- `description`
- `location`
- `conferenceUrl`
- `attendees[]` (name/email/optional/responseStatus)
- `organizer`

## 3. SeriesKey — stable "series" identification
Problem: meeting titles change, and recurring events may have different ids for each instance.

Rule v1:
1) If the source provides `recurringEventId` → `seriesKey = "gcal:" + recurringEventId`
2) Otherwise if `uid` is available → `seriesKey = "ical:" + uid`
3) Otherwise fallback: `seriesKey = "hash:" + sha1(calendarId + title + organizerEmail?)`

Important:
- `seriesKey` must be stable and deterministic.
- Used for:
  - subscriptions
  - series page
  - prev/next links
  - tags/metadata

## 4. Note Metadata (frontmatter)
Each meeting note contains frontmatter, at minimum:

```yaml
type: meeting
title: "... "
start: 2026-02-27T10:00:00+07:00
end: 2026-02-27T10:30:00+07:00
timezone: Asia/Bangkok
source: gcal_api
calendar_id: ...
event_id: ...
ical_uid: ...
series_key: ...
series_name: ...
status: confirmed
draft: true
```

Optional:
- `attendees: []`
- `location`
- `meet_url`
- `tags: [meeting, series/<slug>]`

## 5. File Naming Strategy
Requirements:
- human-readable
- deterministic
- no conflicts

Recommendation:
`Meetings/YYYY-MM-DD/HHmm [SeriesName] Title.md`

Example:
`Meetings/2026-02-27/1000 [TA Standup] Standup.md`

If there is a conflict (two events share the same name):
- add a short suffix from `event_id` or hash: `(... - a1b2).md`

## 6. AUTOGEN sections (contract)
The plugin updates only the following zones:
- `<!-- AUTOGEN:AGENDA:START --> ... <!-- AUTOGEN:AGENDA:END -->`
- `<!-- AUTOGEN:JOINERS:START --> ... <!-- AUTOGEN:JOINERS:END -->`
- `<!-- AUTOGEN:LINKS:START --> ... <!-- AUTOGEN:LINKS:END -->`

Everything else is the user's zone.

## 7. Series Page (optional, but recommended)
File:
`Meetings/_series/<series_slug>.md`

Frontmatter:
```yaml
type: meeting_series
series_key: ...
series_name: ...
```

Contains:
- series description
- default agenda
- list of instances (generated)
