# Recurring Events

Calendar Bridge automatically detects recurring events and creates a dedicated **series index page** for each one, in addition to the individual meeting notes.

## How It Works

All instances of a recurring event share the same RFC 5545 UID in the ICS feed. Calendar Bridge groups them by UID and maintains a single series page that links to every synced instance.

### File locations

| File type | Default location | Example |
|-----------|-----------------|---------|
| Individual meeting note | `Meetings/` | `Meetings/2024-03-07 Weekly Standup.md` |
| Series index page | `Meetings/Series/` | `Meetings/Series/Weekly Standup.md` |

Both folders can be changed in [Configuration](configuration.md).

## Series Index Page

Each series page is generated with this structure:

```markdown
# Weekly Standup

**Calendar:** Work

<!-- AUTOGEN:START -->
## Upcoming Meetings
- [[2024-03-07 Weekly Standup]]
- [[2024-03-14 Weekly Standup]]

## Past Meetings
- [[2024-02-29 Weekly Standup]]
- [[2024-02-22 Weekly Standup]]
<!-- AUTOGEN:END -->

## Notes

*(Series-level notes here)*
```

- **Upcoming Meetings** — instances whose start time is on or after the current time, listed in ascending order.
- **Past Meetings** — instances whose start time is before the current time, listed with the most recent first.

The sections inside the AUTOGEN block are regenerated on every sync. Notes you add outside the AUTOGEN block are preserved.

## Cross-Links

Each individual meeting note for a recurring event includes a `{{series_link}}` line inside its AUTOGEN block that links back to the series page:

```
**Series:** [[Weekly Standup]]
```

This makes it easy to navigate between a specific occurrence and the full series overview.

## Sync Horizon

Only instances that fall within the configured **Sync horizon** are synced and linked. Instances outside the window are not created or updated, but existing notes for past instances are not deleted.
