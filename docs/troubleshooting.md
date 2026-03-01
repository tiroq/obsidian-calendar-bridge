# Troubleshooting

This page covers common issues, error messages, and diagnostic techniques.

---

## Sync produces zero notes

**Symptom**: Sync completes but no notes are created or updated.

Work through the pipeline stages:

### Stage 1: Events fetched?

Open the **Debug tab** in the Calendar Panel. Check the last sync report. Look at **Events fetched**.

- If `0`: the source returned no events.
  - Confirm the source is **enabled** in settings.
  - For Google Calendar: confirm the selected calendars include events in the sync horizon.
  - For ICS: check the URL is reachable (paste it in a browser).
  - Extend `horizonDays` — the default is 3. If your next meeting is 4 days away, increase to 7.

### Stage 2: Events eligible after filters?

Look at **Events eligible** in the sync report.

- If `0` but fetched > 0: events are being filtered out.
  - Check that you have **enabled at least one series** in the Series Manager.
  - Confirm events are not all-day events you've filtered (`panelIncludeAllDay`).
  - Check if events are in the past (horizon is forward-looking only).
  - Declined events are excluded by default — check `panelIncludeDeclined` if you want them.

### Stage 3: Notes planned?

If eligible > 0 but notes written = 0, there may be a filesystem or path issue. Check:
- `meetingsRoot` folder exists (Calendar Bridge creates it, but permissions can prevent this).
- No special characters in the folder path.

---

## Google Calendar authorization fails

| Symptom | Solution |
|---|---|
| "Access blocked: App not verified" | Add your Google account as a test user in Google Cloud Console → OAuth consent screen → Test users. |
| "Error 400: redirect_uri_mismatch" | You created a **Web application** credential instead of **Desktop app**. Re-create the credential with type **Desktop app**. |
| Browser opens but plugin doesn't detect the callback | A firewall or security tool may be blocking the local loopback port. Try disabling firewall temporarily and re-authorizing. |
| "invalid_client" error | The `credentials.json` may be corrupted or from the wrong project. Re-download it from Google Cloud Console. |
| Tokens expire too quickly | This is normal — access tokens last 1 hour but are refreshed automatically. If refresh fails, re-authorize. |

---

## Notes are not updating

**Symptom**: A meeting changes in the calendar but the note is not updated.

- Calendar Bridge only updates the **managed sections** (CB slots and AUTOGEN blocks). Content outside those sections is never touched.
- If the meeting was rescheduled, frontmatter `start`/`end` fields are updated on the next sync.
- If the event was cancelled, `status: cancelled` is added to frontmatter. The note is **not deleted**.
- Series-gated: only enabled series receive updates.

---

## Duplicate notes appearing

**Symptom**: Two notes exist for the same meeting.

This can happen if:
- The `fileNameFormat` or `meetingsRoot` settings were changed after notes were already created. Calendar Bridge can't find the old note at the new expected path.

**Fix**: Manually delete one of the duplicates, then run sync. Calendar Bridge will update the surviving note.

To avoid this: change path/format settings only before any notes exist, or be prepared to reconcile duplicates manually.

---

## Template slots not being filled

**Symptom**: `CB_CONTEXT` or `CB_ACTIONS` slots appear empty.

- These slots require **previous meeting notes** to exist in the vault for the same series. If this is the first meeting in the series, they will be empty.
- Ensure `enableSeriesPages` is on.
- Ensure the previous meeting notes are inside `meetingsRoot` and have the correct `series_key` in frontmatter.

---

## Series not appearing in the Series Manager

**Symptom**: You know you have recurring meetings but they don't appear as series to subscribe to.

- Run **Sync next N days** first — series are discovered during sync, not before.
- Check that the calendar containing the recurring events is selected in the Google Calendar source settings.
- Single (non-recurring) events also appear as series, but with a note that they are one-time events.

---

## Notes created in the wrong folder

**Symptom**: Meeting notes appear in an unexpected location.

Check in order:
1. **Series folder override** — if set in the series profile, this takes precedence over `meetingsRoot`.
2. **`meetingsRoot`** setting — verify it points to the intended root folder.
3. **`dateFolderFormat`** — notes are organized into dated subfolders under `meetingsRoot`. If blank, all notes go directly into `meetingsRoot`.

---

## Debug: Reading the sync report

Open the Calendar Panel → **Debug tab** to see the last N sync reports.

Each report shows:

| Field | Meaning |
|---|---|
| **Events fetched** | Total events returned by all enabled sources |
| **Events eligible** | Events after series gating and filter rules |
| **Notes planned** | Events that will result in a note action |
| **Notes created** | New files written |
| **Notes updated** | Existing files updated |
| **Notes skipped** | Files with no changes (idempotent) |
| **Errors** | Any errors encountered (file write failures, API errors) |
| **Zero reason** | If eligible = 0, why (e.g. "no enabled series", "all events declined") |

---

## Debug: Checking the console

Press `Cmd/Ctrl + Shift + I` in Obsidian to open the developer console. Calendar Bridge logs sync pipeline stages at the `info` level with a `[CalendarBridge]` prefix.

Sensitive values (`access_token`, `refresh_token`, `client_secret`, full ICS URLs for secret sources) are never logged.

---

## Resetting plugin state

If you need to start fresh:

1. Disable all series in the Series Manager.
2. Delete the plugin's data: close Obsidian, delete `.obsidian/plugins/obsidian-calendar-bridge/data.json`.
3. Re-enable the plugin and re-authorize Google Calendar.

> **Warning**: This clears subscriptions, tokens, and cache. Meeting notes in the vault are not affected.

---

## Getting Help

If the above doesn't resolve your issue:

1. Check the [GitHub Issues](https://github.com/tiroq/obsidian-calendar-bridge/issues) for known problems.
2. Open a new issue with:
   - Obsidian version
   - Plugin version (shown in Settings → Community plugins)
   - A copy of the sync report from the Debug tab
   - Steps to reproduce

---

## Related

- [Usage Guide](usage.md) — normal sync workflow
- [Configuration Reference](configuration.md) — all settings
- [Google OAuth Setup](google-oauth.md) — auth troubleshooting
- [ICS Sources](ics-sources.md) — ICS troubleshooting
