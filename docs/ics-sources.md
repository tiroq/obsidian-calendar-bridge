# ICS Sources

Calendar Bridge supports two types of ICS (iCalendar) feeds in addition to Google Calendar:

- **Public ICS** (`ics_public`) — a publicly accessible `.ics` URL, no authentication.
- **Secret ICS** (`ics_secret`) — a private `.ics` URL that acts as a secret token (e.g. private Google Calendar ICS link, Fastmail, Outlook).

Both types work identically in terms of event normalization and sync behavior. The difference is in how the URL is stored and logged: secret ICS URLs are never written to logs or the console.

---

## Finding Your ICS URL

### Google Calendar (private address)

1. Open [calendar.google.com](https://calendar.google.com).
2. In the left sidebar, hover over the calendar you want to add, click the three-dot menu → **Settings and sharing**.
3. Scroll to **Secret address in iCal format**.
4. Copy the URL (it contains a unique token — treat it as a password).

Use **Secret ICS** type for this URL.

### Outlook / Microsoft 365

1. Go to **Outlook.com → Calendar → Settings → Shared calendars**.
2. Under **Publish a calendar**, select the calendar and permission level (**Can view all details** recommended).
3. Click **Publish**, then copy the **ICS** link.

Use **Secret ICS** type if the link is not meant to be public.

### Apple Calendar (iCloud)

1. Open iCloud.com → Calendar.
2. Click the share icon next to a calendar → enable **Public Calendar**.
3. Copy the URL shown.

Use **Public ICS** type (iCloud public calendar URLs are not secret).

### Fastmail / ProtonMail

Check your provider's help docs for "export ICS" or "subscribe to calendar". The URL format varies by provider.

---

## Adding an ICS Source

1. Open **Settings → Calendar Bridge → Sources → Add source**.
2. Select **Public ICS** or **Secret ICS** as the source type.
3. Enter a **Name** for the source (shown in the panel).
4. Paste the ICS URL into the **URL** field.
5. Set the **Poll interval** (default: 60 minutes).
6. Enable the source and click **Save**.

---

## Poll Interval

The poll interval controls how often Calendar Bridge re-fetches the ICS feed to check for changes.

| Interval | Use case |
|---|---|
| 15 minutes | Frequently updated calendars (work schedules, shared team calendars) |
| 60 minutes (default) | Most personal calendars |
| 240+ minutes | Rarely changing calendars (holidays, public events) |

ICS feeds are fetched using conditional HTTP requests (`If-None-Match` / `If-Modified-Since`) when the server supports it. Unchanged feeds are not re-parsed, saving bandwidth.

---

## ICS Caching

Calendar Bridge maintains a local cache of ICS feed state in `cache.json`. The cache stores:

- The last `ETag` and `Last-Modified` headers from the server.
- The last fetch timestamp per source.
- A mapping from event UID → vault note path (for conflict resolution).

You can optionally persist `cache.json` inside the vault (see `writeStateInVault` in [Configuration](configuration.md)).

---

## Limitations

| Limitation | Detail |
|---|---|
| **Read-only** | Calendar Bridge cannot write to ICS feeds |
| **Recurring event support** | Recurring ICS events are supported; exception instances (modified occurrences) are handled |
| **Timezone** | `TZID` from `VEVENT` is used; fall back to `timezoneDefault` if absent |
| **All-day events** | Supported; controlled by `panelIncludeAllDay` for panel display |
| **Private events** | Title shows as `(Private)` if the event is marked private in the ICS |

---

## Troubleshooting ICS Sources

| Problem | Solution |
|---|---|
| Events not appearing | Check that the source is enabled and the URL is reachable. Try pasting the URL in a browser. |
| Stale events / not updating | Reduce the poll interval. Some providers only update ICS exports every few hours. |
| SSL certificate error | The URL must use `https://`. Self-signed certs are not supported. |
| Wrong times / timezone issues | Set `timezoneDefault` in settings to the correct IANA timezone (e.g. `America/New_York`). |
| Duplicate events | Events from multiple sources with the same UID are deduplicated automatically. |

---

## Related

- [Configuration Reference](configuration.md) — poll interval, `timezoneDefault`, `writeStateInVault`
- [Troubleshooting](troubleshooting.md) — general sync issues
