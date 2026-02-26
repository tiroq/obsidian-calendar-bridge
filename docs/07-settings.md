# 07 — Settings & Compatibility

## 1. Settings (global)
- `sourceType`: gcal_api | ics_public | ics_secret
- `horizonDays` (default 3)
- `meetingsRoot` (default `Meetings/`)
- `seriesRoot` (default `Meetings/_series/`)
- `templatePath` (default `Templates/meeting.md`)
- `enableSeriesPages` (bool)
- `enablePrevNextLinks` (bool)
- `autoSyncIntervalMinutes` (0=off)
- `timezoneDefault` (optional; otherwise system)
- `dateFolderFormat` (e.g. `YYYY-MM-DD`)
- `fileNameFormat` (e.g. `{time} [{series}] {title}`)
- `writeStateInVault` (bool, default false)

## 2. Source-specific settings

### Google API
- `clientId`
- `clientSecret` (required for the flow; prefer PKCE, but depends on implementation)
- `scopes` (minimum read-only)
- `selectedCalendarIds[]`
- `includeConferenceData` (bool)

### ICS
- `icsUrl` (secret/public)
- `pollIntervalMinutes`
- `cacheEtag` / `lastModified` (for conditional GET)

## 3. Migrations
When the state schema changes:
- store `stateVersion`
- write and test migrations separately

## 4. Compatibility with other plugins
- Templates plugins (Templater): do not conflict; the plugin works with its own template.
- Dataview: the frontmatter schema should be friendly/compatible.
