# Changelog

All notable changes to Calendar Bridge are documented here. Versions follow [Semantic Versioning](https://semver.org/).

---

## v1.11.2 — 2026-03-01

**Chore / tooling**

- `task gh-release` now runs `git push origin main --tags` before creating the GitHub release, preventing "tag exists locally but not on remote" errors.
- Added `task rel` as a short alias for `task gh-release`.

---

## v1.11.1 — 2026-02-28

**Metrics**

- Added `MetricsService` to compute and render meeting series health metrics into the `CB_DIAGNOSTICS` slot on series index pages.
- Health table includes: total meetings tracked, note coverage %, last synced date, meeting cadence.

---

## v1.11.0 — 2026-02-27

**Premium CB slots wired**

- `ContextService` is now wired into CB slot injection — the `CB_CONTEXT` slot shows a summary of the last 3 meetings in a series.
- `ActionAggregationService` is now wired — the `CB_ACTIONS` slot carries open action items (`- [ ]` lines) from the last 5 meetings.
- `MetricsService` wired into series page generation for the `CB_DIAGNOSTICS` slot.
- Added 53 new tests for `ContextService`, `ActionAggregationService`, and `MetricsService`.

---

## v1.10.0 — 2026-02-24

**Template routing and planning**

- Extracted `PlanningService` — a pure, read-only sync plan builder separated from the sync orchestrator.
- `TemplateRoutingService` and `TemplateService` are now wired into the sync pipeline: each event gets its template resolved through the 6-level routing chain before note generation.
- Added `templateRoutes` to `PluginSettings` for configuring per-event template routing rules.
- `getSeriesProfile` callback added to `runSync` for per-series customization.

---

## v1.9.0 — 2026-02-20

**Slot-based template system**

- New `TemplateRoutingService` with 6-level priority routing: series key → calendar ID → title regex → attendee domain → tag → global default.
- Rewrote template slot system with idempotent `CB:BEGIN`/`CB:END` markers — managed content is updated without touching surrounding manual content.
- Improved CI workflow: Jest tests and TypeScript build now run in GitHub Actions.

---

## v1.8.0 — 2026-02-15

**Diagnostics and filtering**

- Added `FilterService` — event filtering with structured reason codes for each excluded event.
- Added `DiagnosticsService` — accumulates sync reports with per-stage counts and error lists.
- Added **Debug section** in the Calendar Panel showing last sync report (fetched / eligible / planned / created / updated / skipped / errors).
- Added `SyncReport` and `SyncReportEntry` types.
- Fixed: template-not-found errors are now surfaced in the UI as a notice rather than silently skipped.
- Fixed: Sync button correctly disabled when not connected to any calendar source.
- 49 new tests for `FilterService` and `DiagnosticsService`.

---

## v1.7.0 — 2026-02-10

**Contact integration**

- Added `ContactsFolder` setting — a vault folder scanned for Person notes whose `email` frontmatter field is matched to event attendees.
- Contact map is built once per sync and injected into attendee blocks.
- `ContactMap` is wired into `buildJoinersBlock`, `buildFrontmatter`, and `FillTemplateOptions`.

---

## v1.6.x — 2026-02-01 to 2026-02-08

**Series UI and hidden series**

- v1.6.0: Added **hidden series** feature — toggle a series to hide it from the Series tab UI without affecting sync. Hidden series are collapsed into a separate section.
- v1.6.1 – v1.6.6: Bug fixes and stability improvements to series state management, ICS caching, and OAuth token refresh.

---

## v1.5.x — 2026-01-20 to 2026-01-31

**ICS support and file path fixes**

- Added Public ICS and Secret ICS source types.
- ICS feed caching with `ETag`/`Last-Modified` conditional requests.
- Fixed: date subfolders are now created before `vault.create` (prevented file write failures).
- Fixed: single (non-recurring) events always sync regardless of series subscription state.

---

## v1.4.0 — 2026-01-15

**Auto-sync and startup sync**

- Added configurable auto-sync interval (default: 60 minutes, `0` = off).
- Added sync-on-startup option (default: on).
- Status bar now shows last sync time and error indicator.

---

## v1.3.x — 2026-01-08 to 2026-01-12

**Series pages and prev/next links**

- Added series index page generation (`enableSeriesPages` setting).
- Added prev/next navigation links between consecutive meetings in a series (`enablePrevNextLinks` setting).
- Series pages live in `seriesRoot` (default: `Meetings/_series`).

---

## v1.2.x — 2025-12-15 to 2026-01-05

**Foundation and Google Calendar integration**

- Initial Google Calendar OAuth 2.0 + PKCE integration (Desktop app client type).
- Calendar selection: choose which Google calendars to include in sync.
- Note generation with AUTOGEN blocks (`AGENDA`, `JOINERS`).
- Frontmatter: `type`, `title`, `start`, `end`, `series_key`, `draft`, `status`.
- Series subscription manager modal.
- Sync preview modal.
- Calendar Panel view (right sidebar).
- Configurable meetings root folder, file name format, and date folder format.
- Redaction mode (omits attendees and conference links from notes).
