# Configuration

All settings are available under **Settings** → **Calendar Bridge**.

## Calendar Sources

You can add as many ICS calendar feeds as you like. Each source has three fields:

| Field | Description |
|-------|-------------|
| **Name** | A label used in note metadata and sync notifications (e.g. `Work`, `Personal`). |
| **ICS URL** | A full `https://` URL to an ICS feed. Google Calendar users can find this under *Calendar settings → Integrate calendar → Secret address in iCal format*. |
| **Enabled** | Toggle to include or exclude this source from syncs without deleting it. |

To add a source click **＋ Add calendar source**. To remove one click the trash icon next to it.

## Sync Settings

### Notes folder

Default: `Meetings`

The vault folder where individual meeting notes are created. The folder is created automatically if it does not exist.

### Series folder

Default: `Meetings/Series`

The vault folder where recurring-series index pages are stored. See [Recurring Events](recurring-events.md) for details.

### Template note path

Default: *(empty — uses the built-in template)*

Path to a custom note template inside your vault, e.g. `Templates/Meeting.md`. Leave blank to use the built-in template. See [Templates](templates.md) for placeholder syntax.

### Sync horizon (days)

Default: `14`  
Range: 1 – 90

How many calendar days ahead of today to include when syncing. Events that start after this window are ignored.

### Sync on startup

Default: enabled

When turned on, Calendar Bridge automatically runs a sync each time Obsidian opens.

## Format Settings

### Date format

Default: `YYYY-MM-DD`

Controls how dates appear in note filenames and content. Supported tokens:

| Token | Meaning | Example |
|-------|---------|---------|
| `YYYY` | 4-digit year | `2024` |
| `MM` | 2-digit month | `03` |
| `DD` | 2-digit day | `07` |

### Time format

Default: `HH:mm`

Controls how times appear in note content. Supported tokens:

| Token | Meaning | Example |
|-------|---------|---------|
| `HH` | 24-hour hour | `14` |
| `mm` | Minutes | `30` |

## Actions

### Sync now

Manually triggers a full sync without waiting for startup or the ribbon icon. The button is disabled while a sync is in progress.

### Last synced

Displays the date and time of the most recent successful sync.
