# 01 — Calendar Sources (Share/ICS vs OAuth/API)

## 1. Why this file
User request: "can't we just share the calendar?". For Google Calendar there are indeed several access modes. This file captures the options, trade-offs, and recommended path for a community plugin.

## 2. Source options

### A) Public ICS (public iCal link)
**How it works**
- The calendar is made public.
- The "Public address in iCal format" is used.
- The plugin downloads the `.ics` file and parses events.

**Pros**
- Zero OAuth.
- Simple to implement.
- Works in environments where OAuth is not allowed.

**Cons / Risks**
- The calendar becomes public: potential leakage of meeting titles, descriptions, attendees, Meet links.
- Often unacceptable for a work calendar.

**When appropriate**
- A public events/community calendar.
- A "shared" team calendar where the data is not sensitive.

### B) Secret ICS (secret iCal link)
**How it works**
- The calendar is private, but a "Secret address in iCal format" is provided.
- The plugin downloads the `.ics` file and parses it.

**Pros**
- Zero OAuth.
- Fast.
- Convenient for a single user.

**Cons / Limitations**
- The secret link is "like a password": if it leaks, third parties gain access.
- Some clients may have issues with URL-based subscriptions; behavior can be unstable.
- No guarantee of receiving extended fields (attendees, visibility) consistently.
- Cannot make targeted requests (incremental sync) as efficiently as through an API.

**When appropriate**
- Personal workflow, if the user is willing to store the secret URL locally.
- MVP for users who cannot use OAuth.

### C) Google Calendar API (OAuth 2.0, events.list)
**How it works**
- The user authorizes the plugin.
- The plugin reads events via the API within a date range, with recurring event expansion (singleEvents=true).
- Richer data can be received (attendees, organizer, conferenceData when permissions allow).

**Pros**
- Best data quality.
- Incrementality/delta (sync token) — potentially.
- Managed scopes and a more transparent access model.

**Cons**
- OAuth is more complex (especially on mobile).
- Requires a Cloud project / OAuth consent screen / publication requirements.
- For a community plugin it is important not to create a centralized backend to avoid collecting user data.

**Recommended path for community plugin**
- Core: API/OAuth as "primary source".
- Additionally: "ICS (secret/public)" mode as an alternative source.

### D) CalDAV (theoretical)
Google Calendar partially supports CalDAV, but in practice this adds auth complexity and provides no advantages over the API for the required fields. Not in v1.

## 3. Architectural requirement: Source Adapter
The plugin must have a `CalendarSource` interface:
- `listCalendars()`
- `listEvents(timeMin, timeMax, options)`
- `getEvent(eventId)` (optional)
- `capabilities`: `{ attendees?: boolean, conference?: boolean, incremental?: boolean }`

So the user can choose:
- Google API
- ICS (public)
- ICS (secret)

## 4. UX: source selection and risks
The settings must include an explicit block:
- source type
- privacy warnings
- connection test ("Test & Preview")

## 5. Required fields
Minimum set that must be obtained even from ICS:
- title/summary
- start/end (with TZ)
- location / meeting URL (best-effort)
- description (best-effort)

API mode adds:
- attendees (emails)
- organizer
- status/cancelled
- recurring identifiers
