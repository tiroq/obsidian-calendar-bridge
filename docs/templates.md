# Templates

Calendar Bridge uses a simple token-based template system to generate meeting notes. You can use the built-in template or supply your own.

## Built-in Template

When no custom template is configured the following template is used:

```markdown
# {{title}}

**Date:** {{date}}
**Time:** {{time}} – {{end_time}}
**Duration:** {{duration}}
**Location:** {{location}}

<!-- AUTOGEN:START -->
**Organizer:** {{organizer}}

**Attendees:**
{{attendees}}

**Description:**
{{description}}

**Calendar:** {{source}}
{{series_link}}<!-- AUTOGEN:END -->

## Notes

*(Add your notes here)*

## Action Items

- [ ] 
```

## Using a Custom Template

1. Create a note anywhere in your vault (e.g. `Templates/Meeting.md`).
2. Open **Settings** → **Calendar Bridge** → **Template note path** and enter the vault path to that note.
3. Trigger a sync — all new meeting notes will use your template.

## Available Placeholders

Placeholders are written as `{{token}}` and are replaced when a note is created.

| Placeholder | Description |
|-------------|-------------|
| `{{title}}` | Event title |
| `{{date}}` | Event start date, formatted with the **Date format** setting |
| `{{time}}` | Event start time, formatted with the **Time format** setting (or `All day` for all-day events) |
| `{{end_time}}` | Event end time, formatted with the **Time format** setting (empty for all-day events) |
| `{{duration}}` | Human-readable duration, e.g. `30m`, `1h`, `1h 30m` (or `All day`) |
| `{{location}}` | Event location |
| `{{organizer}}` | Event organizer as `Name <email>` (or just `email` if no name is available) |
| `{{attendees}}` | Bullet list of attendees, one per line, as `- Name <email>` |
| `{{description}}` | Event description / body text |
| `{{source}}` | Display name of the calendar source this event came from |
| `{{uid}}` | RFC 5545 UID of the event |
| `{{series_link}}` | Wikilink to the series index page for recurring events (e.g. `**Series:** [[Weekly Standup]]`); empty for non-recurring events |

## AUTOGEN Blocks

The region between `<!-- AUTOGEN:START -->` and `<!-- AUTOGEN:END -->` is the **auto-generated block**. On every sync:

- The AUTOGEN block is **replaced** with fresh data from the calendar.
- Everything **outside** the block is left untouched, preserving notes, action items, and any other edits you have made.

You can move the AUTOGEN markers anywhere in your custom template (even at the very top or bottom), but keep the markers on their own lines to avoid unexpected formatting.

> **Tip:** If you delete the AUTOGEN markers from a note entirely, Calendar Bridge will append the updated block to the end of that note on the next sync rather than modifying anything in the middle of the file.
