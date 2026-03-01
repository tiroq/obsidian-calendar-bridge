# Usage Guide

Calendar Bridge turns your calendar into structured, series-aware meeting notes inside Obsidian. This guide walks you through getting started and day-to-day use.

---

## Quick Start

### 1. Install the plugin

Install Calendar Bridge from the Obsidian Community Plugins browser, or copy `main.js` and `manifest.json` into `.obsidian/plugins/obsidian-calendar-bridge/` and enable it in **Settings → Community plugins**.

### 2. Add a calendar source

Open **Settings → Calendar Bridge → Sources** and add a source:

- **Google Calendar** — requires OAuth setup. See [Google OAuth Setup](google-oauth.md).
- **Public ICS** — paste a public `.ics` URL directly.
- **Secret ICS** — paste a private `.ics` URL (treated as a credential; not logged).

### 3. Select your meeting series

Run the command **Select/Manage series subscriptions** (or press the ribbon calendar icon to open the panel, then switch to the Series tab).

Calendar Bridge will show all recurring meeting series it has discovered. Toggle on the series you want notes for.

### 4. Run your first sync

Run the command **Sync next N days** from the command palette (`Cmd/Ctrl + P`).

Calendar Bridge will:
1. Fetch events from enabled sources within the sync horizon (default: 3 days ahead).
2. Filter to enabled series and non-declined events.
3. Create or update meeting notes in your vault.

---

## Day-to-Day Workflow

### Commands

| Command | What it does |
|---|---|
| **Sync next N days** | Fetch events and generate/update notes for the upcoming horizon |
| **Preview sync plan** | Show what notes would be created/updated without writing anything |
| **Select/Manage series subscriptions** | Open the series manager to enable/disable meeting series |
| **Open series page (for current note)** | Navigate to the series index page for the currently open meeting note |
| **Create note for selected event** | Manually create a note for a specific event (opens event picker) |

### Auto-sync

Calendar Bridge syncs automatically on startup (configurable) and at a set interval (default: 60 minutes). You can adjust both in **Settings → Calendar Bridge → Sync**.

### Status bar

The bottom-right status bar shows the last sync time. If a sync fails, it shows a brief error indicator.

---

## The Calendar Panel

Click the calendar ribbon icon (or run the panel command) to open the Calendar Panel in the right sidebar.

The panel provides:

- **Events list** — upcoming events within the panel horizon (default: 5 days), with conference links, attendee counts, and location extracted inline.
- **Sync Now button** — trigger a sync with a live progress bar.
- **Series tab** — manage series subscriptions directly from the panel.
- **Calendars tab** — view connected calendars with color indicators.
- **Debug tab** — inspect the last sync report (stages, counts, errors).

### Panel filters

The panel respects a separate set of filters from the sync engine:

- Include/exclude all-day events
- Include/exclude declined events
- Only show events with attendees
- Skip events shorter than N minutes
- Filter by title keywords or regex

Configure these in **Settings → Calendar Bridge → Panel**.

---

## Understanding Sync Behavior

### Horizon

The sync horizon (`horizonDays`, default 3) controls how far ahead Calendar Bridge looks when generating notes. Events beyond the horizon are ignored.

### Idempotency

Sync is safe to run repeatedly. Calendar Bridge:

- **Creates** a new note if none exists for the event.
- **Updates** only the managed sections (CB slots and AUTOGEN blocks) if a note already exists.
- **Never overwrites** your manual content outside managed sections.
- **Marks** cancelled events in frontmatter (`status: cancelled`) but does not delete the note.

### Series gating

Only series you have explicitly enabled will have notes generated. New series discovered during sync are offered for subscription in the Series Manager — they do not auto-generate notes until enabled.

---

## Inline Hints

When you open a meeting note, Calendar Bridge displays a brief inline hint at the top:

- **"Meeting in X minutes"** — if the meeting is upcoming within 60 minutes.
- **"Cancelled"** — if the event was cancelled in the calendar.

These hints are transient and do not modify the note file.

---

## Meeting Note Structure

A generated meeting note looks like this:

```markdown
---
type: meeting
title: Team Standup
start: 2026-03-01T10:00:00+07:00
end: 2026-03-01T10:15:00+07:00
series_key: gcal:abc123
draft: true
---

<!-- CB:BEGIN CB_HEADER -->
## Team Standup
**2026-03-01 10:00 → 10:15**
<!-- CB:END CB_HEADER -->

<!-- CB:BEGIN CB_LINKS -->
[Join Meeting](https://meet.google.com/abc-def-ghi)
<!-- CB:END CB_LINKS -->

<!-- CB:BEGIN CB_CONTEXT -->
*Context from previous 3 meetings...*
<!-- CB:END CB_CONTEXT -->

<!-- CB:BEGIN CB_ACTIONS -->
*Carry-over actions from previous meetings...*
<!-- CB:END CB_ACTIONS -->

<!-- CB:BEGIN CB_BODY -->
## Notes

(Your content here — never overwritten)
<!-- CB:END CB_BODY -->
```

The sections marked `CB:BEGIN` / `CB:END` are managed by the plugin. Everything else is yours.

---

## Next Steps

- [Configuration Reference](configuration.md) — all settings explained
- [Templates](templates.md) — customize CB slots and note structure
- [Series Management](series.md) — recurring meetings and series pages
- [Google OAuth Setup](google-oauth.md) — connecting Google Calendar
- [ICS Sources](ics-sources.md) — adding ICS feeds
- [Troubleshooting](troubleshooting.md) — common issues
