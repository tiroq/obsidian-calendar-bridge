# Series Management

Calendar Bridge is built around the concept of **meeting series** — recurring meetings that share a stable identity across time. This page explains how series work, how to manage subscriptions, and what series pages contain.

---

## What Is a Series?

A series is a group of recurring calendar events identified by a stable **series key**. For Google Calendar events, the key is derived from the recurring event ID. For ICS events, it comes from the `UID` field in the iCal data.

Series keys are stable — they don't change when an event is rescheduled or renamed.

Examples:
- `gcal:abc123xyz` — a recurring Google Calendar event
- `ics:uid:weekly-standup@example.com` — an ICS recurring event

---

## Series Subscriptions

**Notes are only generated for series you have explicitly subscribed to.**

New series discovered during sync appear in the Series Manager but do not produce notes until you enable them.

### Opening the Series Manager

- Run the command **Select/Manage series subscriptions**, or
- Open the Calendar Panel (ribbon icon) and switch to the **Series** tab.

### Enabling a series

Toggle the switch next to a series name to enable it. Calendar Bridge will generate notes for that series on the next sync.

### Disabling a series

Toggle off. Existing notes are not deleted. Future syncs will skip the series.

### Hiding a series

Each series has a **hide** option in the Series Manager. Hiding a series removes it from the Series tab UI list but **does not affect sync** — if the series is enabled, notes are still generated. Hiding is purely cosmetic.

---

## Series Profiles

Each series has a profile that can be customized in the Series Manager:

| Field | Description |
|---|---|
| **Series name** | Display name (auto-detected from the first event title, editable) |
| **Enabled** | Whether notes are generated for this series |
| **Hidden** | Whether the series is shown in the UI list |
| **Folder override** | Override the note folder for this series (relative to `meetingsRoot`) |
| **Template override** | Use a specific template for this series (overrides template routing) |
| **Default agenda** | Markdown text prepended to the `CB_BODY` slot on new notes |
| **Tags** | Tags applied to every note in this series |
| **Pinned attendees** | Email addresses always included in the attendee list |
| **Hidden attendees** | Email addresses never shown in the attendee list |

---

## Series Pages

When **Enable series pages** is on (default), Calendar Bridge maintains a series index page for every subscribed series.

Series pages live in `seriesRoot` (default: `Meetings/_series`).

### What's on a series page

A series page contains:

- **Series name** and metadata (calendar, first seen, last seen)
- **Meeting list** — links to all known notes for this series, sorted by date
- **Prev/Next navigation** — if enabled, links between consecutive meetings
- **CB_DIAGNOSTICS slot** — health metrics table showing:
  - Total meetings tracked
  - Notes coverage percentage
  - Last synced date
  - Meeting cadence (weekly, biweekly, etc.)
  - Sync health status

### Series page naming

Series page filenames are derived from the series name, sanitized for the filesystem. Example: `Team Standup.md` under `Meetings/_series/`.

---

## Prev/Next Links

When **Enable prev/next links** is on (default), every meeting note gets navigation links injected into the `CB_LINKS` slot:

```markdown
← [[2026-02-22T10:00 Team Standup|Previous]]  |  [[2026-03-08T10:00 Team Standup|Next]] →
```

Links are updated on each sync as new meetings enter the horizon.

---

## Context and Actions (Premium Slots)

For recurring series, two slots provide cross-meeting continuity:

### CB_CONTEXT

The `CB_CONTEXT` slot is populated with a summary of the **3 most recent meetings** in the series that have existing notes. It shows:

- Meeting date and title
- A brief excerpt from the note body

This gives you context on what was discussed without leaving the current note.

### CB_ACTIONS

The `CB_ACTIONS` slot scans the **last 5 meeting notes** in the series for open action items. An action item is any line matching `- [ ] …`. Carry-over items are injected so nothing is forgotten between meetings.

Both slots are only populated when notes for previous meetings in the series already exist in the vault.

---

## Series Key Discovery

Calendar Bridge discovers series keys automatically:

- **Google Calendar**: Uses the `recurringEventId` field from the API.
- **ICS**: Uses the `UID` field from the VEVENT component, normalized to lowercase.
- **Single events**: Get a synthetic series key derived from the event ID. They behave like a series with one member.

---

## Related

- [Templates](templates.md) — CB_CONTEXT, CB_ACTIONS, CB_DIAGNOSTICS slot details
- [Configuration Reference](configuration.md) — `seriesRoot`, `enableSeriesPages`, `enablePrevNextLinks`
- [Usage Guide](usage.md) — day-to-day sync workflow
