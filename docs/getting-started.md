# Getting Started with Calendar Bridge

Calendar Bridge is an [Obsidian](https://obsidian.md) plugin that pulls events from Google Calendar (or any ICS feed) and turns them into structured meeting-note drafts inside your vault.

## Requirements

- Obsidian 1.0 or later
- A publicly accessible ICS feed URL (e.g. a Google Calendar "Secret address in iCal format")

## Installation

### From the Community Plugin Store (recommended)

1. Open Obsidian → **Settings** → **Community plugins**.
2. Click **Browse**, search for **Calendar Bridge**, and install it.
3. Enable the plugin with the toggle.

### Manual installation

1. Download the latest `main.js` and `manifest.json` from the [Releases](https://github.com/tiroq/obsidian-calendar-bridge/releases) page.
2. Copy both files to `<vault>/.obsidian/plugins/obsidian-calendar-bridge/`.
3. Reload Obsidian and enable the plugin in **Settings** → **Community plugins**.

## Quick Start

1. Open **Settings** → **Calendar Bridge**.
2. Under **Calendar Sources**, click **＋ Add calendar source**.
3. Give the source a **Name** (e.g. `Work`) and paste your ICS URL.
4. Click the **Sync now** button (or the calendar-days ribbon icon).

Meeting notes are created in the `Meetings/` folder by default. Each note follows the pattern:

```
Meetings/YYYY-MM-DD <Event Title>.md
```

Recurring-event series pages are placed in `Meetings/Series/` by default.

## Next Steps

- [Configuration](configuration.md) — customise folders, sync horizon, date/time formats, and templates.
- [Templates](templates.md) — learn which placeholders are available and how to write your own template.
- [Recurring Events](recurring-events.md) — understand how series index pages work.
