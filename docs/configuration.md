# Configuration Reference

All Calendar Bridge settings live under **Settings → Calendar Bridge**. This page documents every available option with its default value and behavior.

---

## Sources

Sources are calendar connections. You can have multiple sources of different types active simultaneously.

| Field | Type | Description |
|---|---|---|
| **Source type** | `gcal_api` / `ics_public` / `ics_secret` | Protocol used to fetch events |
| **Enabled** | boolean | Whether this source participates in sync |
| **Name** | string | Display name shown in the panel |

Add sources via **Settings → Calendar Bridge → Sources → Add source**.

### Google Calendar source (`gcal_api`)

Requires OAuth credentials. See [Google OAuth Setup](google-oauth.md) for the full setup walkthrough.

| Field | Description |
|---|---|
| **Client credentials** | Load from a `credentials.json` file downloaded from Google Cloud Console |
| **Selected calendars** | Which calendars to include in sync (multi-select after authorization) |
| **Include conference data** | Extract Google Meet / Zoom / Teams join links (default: on) |

### ICS source (`ics_public` / `ics_secret`)

| Field | Default | Description |
|---|---|---|
| **URL** | — | Full `https://` URL to the `.ics` feed |
| **Poll interval** | 60 min | How often to re-fetch the feed |

For secret feeds, the URL is treated as a credential — it is never logged.

---

## Sync

| Setting | Default | Description |
|---|---|---|
| **Horizon days** (`horizonDays`) | `3` | How many days ahead to look when generating notes |
| **Auto-sync interval** (`autoSyncIntervalMinutes`) | `60` | Minutes between automatic syncs. Set to `0` to disable auto-sync |
| **Sync on startup** (`syncOnStartup`) | `true` | Run a sync automatically when Obsidian loads |

---

## Paths

| Setting | Default | Description |
|---|---|---|
| **Meetings root** (`meetingsRoot`) | `Meetings` | Vault-relative folder where meeting notes are created |
| **Series root** (`seriesRoot`) | `Meetings/_series` | Vault-relative folder where series index pages live |
| **Template path** (`templatePath`) | _(empty)_ | Vault path to your default meeting note template |
| **Contacts folder** (`contactsFolder`) | _(empty)_ | Vault folder scanned for Person notes whose `email` frontmatter field is matched to attendees |

### Template routes

Template routes let you assign different templates to different meetings. Routes are evaluated in priority order:

1. Series key exact match
2. Calendar ID exact match
3. Title regex match
4. Attendee domain match
5. Tag match
6. Global default (`templatePath`)

Configure routes in **Settings → Calendar Bridge → Template Routes**.

---

## Features

| Setting | Default | Description |
|---|---|---|
| **Enable series pages** (`enableSeriesPages`) | `true` | Auto-generate and maintain an index page for each subscribed series |
| **Enable prev/next links** (`enablePrevNextLinks`) | `true` | Add navigation links to adjacent meetings in the same series |
| **Write state in vault** (`writeStateInVault`) | `false` | Save `subscriptions.json` and `cache.json` inside the vault (useful for sync across devices) |

---

## Format

| Setting | Default | Description |
|---|---|---|
| **Date folder format** (`dateFolderFormat`) | `YYYY-MM-DD` | [Moment.js format](https://momentjs.com/docs/#/displaying/format/) for the date subfolder under `meetingsRoot` |
| **File name format** (`fileNameFormat`) | `{time} [{series}] {title}` | Template for note filenames. Tokens: `{time}`, `{series}`, `{title}`, `{date}` |
| **Timezone** (`timezoneDefault`) | _(system)_ | Override the timezone used for formatting times. Empty = use system timezone |
| **Date format** (`dateFormat`) | `YYYY-MM-DD` | Moment.js format used in note frontmatter and links |
| **Time format** (`timeFormat`) | `HH:mm` | Moment.js format used in note filenames and frontmatter |

### File name tokens

| Token | Resolved to |
|---|---|
| `{time}` | Meeting start time formatted with `timeFormat` |
| `{date}` | Meeting date formatted with `dateFormat` |
| `{title}` | Sanitized event title |
| `{series}` | Series display name (or `_` if not part of a series) |

---

## Privacy

| Setting | Default | Description |
|---|---|---|
| **Redaction mode** (`redactionMode`) | `false` | When enabled, attendee email addresses and conference join links are omitted from all generated notes |

---

## Panel

Panel settings control the Calendar Panel view (right sidebar). They are independent from the sync engine settings.

| Setting | Default | Description |
|---|---|---|
| **Panel horizon days** (`panelHorizonDays`) | `5` | How many days ahead the panel event list shows |
| **Include all-day events** (`panelIncludeAllDay`) | `true` | Show all-day events (e.g. holidays, OOO) in the panel |
| **Include declined events** (`panelIncludeDeclined`) | `false` | Show events you declined |
| **Only with attendees** (`panelOnlyWithAttendees`) | `false` | Hide events with no other attendees |
| **Skip shorter than** (`panelSkipShorterThanMin`) | `0` | Minimum event duration in minutes; set to `0` to disable |
| **Extract conference links** (`panelExtractConferenceLinks`) | `true` | Parse and display Google Meet / Zoom / Teams links inline |
| **Extract attendees** (`panelExtractAttendees`) | `true` | Show attendee count inline |
| **Extract location** (`panelExtractLocation`) | `true` | Show location field inline |
| **Exclude titles** (`panelExcludeTitles`) | _(empty)_ | Comma-separated keywords (or regex patterns). Events whose titles match are hidden |
| **Include titles** (`panelIncludeTitles`) | _(empty)_ | Comma-separated keywords (or regex patterns). When set, only matching events are shown |
| **Title regex mode** (`panelTitleRegexMode`) | `false` | Treat title filter strings as regular expressions |

---

## Related

- [Templates](templates.md) — detailed template and CB slot reference
- [Series Management](series.md) — series subscriptions and series pages
- [Google OAuth Setup](google-oauth.md) — credential setup walkthrough
- [ICS Sources](ics-sources.md) — ICS feed configuration
