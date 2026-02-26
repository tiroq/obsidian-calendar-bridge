# Calendar Bridge

Turn your calendar into structured, series-aware meeting notes inside Obsidian.

Calendar Bridge connects Google Calendar or ICS feeds and automatically generates clean, template-based meeting drafts ahead of time — without overwriting your manual notes.

---

## ✨ Why Calendar Bridge?

Most calendar integrations only sync events.

Calendar Bridge creates **real meeting infrastructure inside your Vault**:

- Structured meeting drafts for upcoming events
- Series-aware subscriptions (recurring meetings handled correctly)
- Cross-links between meetings
- Dedicated series pages
- Idempotent updates (your notes are safe)

It is designed for professionals who treat meetings as long-term knowledge assets.

---

## 🚀 Features

### 📅 Calendar Sources
- Google Calendar (OAuth, read-only)
- Public ICS
- Secret ICS feeds

### 🗂 Automatic Draft Generation
- Sync next N days (default: 3)
- Generate notes only for selected series
- Deterministic file naming
- Customizable folder structure

### 🔁 Series Awareness
- Detect recurring meetings
- Subscribe/unsubscribe per series
- Auto-generated series index pages
- Optional Prev/Next navigation links

### 🧩 Template-Based Notes
- Uses your own meeting template
- Supports dynamic placeholders
- Protected AUTOGEN blocks (only managed sections are updated)
- Manual edits outside AUTOGEN blocks are preserved

### 🛡 Safe & Idempotent
- No duplicate files
- Frontmatter intelligently merged
- Cancelled meetings marked, not deleted
- No external data collection

---

## 🏗 How It Works

1. Connect your calendar (Google API or ICS).
2. Select which meeting series to enable.
3. Run sync.
4. Calendar Bridge generates structured drafts for upcoming meetings.
5. You take notes during the meeting.
6. The plugin maintains links and metadata — without touching your content.

---

## 📄 Example Generated Note

```yaml
type: meeting
title: Team Standup
start: 2026-02-27T10:00:00+07:00
end: 2026-02-27T10:15:00+07:00
series_key: gcal:abc123
draft: true
```

```markdown
## Agenda
<!-- AUTOGEN:AGENDA:START -->
- Sprint updates
- Blockers
<!-- AUTOGEN:AGENDA:END -->

## Notes
(Your content here — never overwritten)
```

---

## ⚙ Settings

- Sync horizon (days ahead)
- Meeting root folder
- Series folder
- Template path
- Enable/disable series pages
- Enable/disable Prev/Next links
- Auto-sync interval
- Calendar selection

---

## Privacy & Data Handling

Calendar Bridge uses Google OAuth (read-only) to access your calendar events.

The plugin:

- Requests only calendar.readonly scope
- Reads event metadata (title, time, attendees, conference links)
- Does NOT modify calendar events
- Does NOT send any data to developer servers
- Stores tokens locally on the user's device
- Performs all processing inside the Obsidian vault

No analytics, telemetry, or external tracking is included.

Calendar Bridge operates entirely locally. The developer does not collect, store, or process user data.

---

## 🧠 Designed for Knowledge Builders

Calendar Bridge is built for:

- Engineers
- Consultants
- Researchers
- Team leads
- Anyone who wants meetings to become structured, linked knowledge

---

## 🛣 Roadmap

- Virtual rule-based series
- State sync between devices
- Mobile OAuth improvements
- Optional AI-assisted agenda suggestions (opt-in only)

---

## 🧩 Compatibility

Works with:
- Obsidian Desktop
- Dataview (frontmatter friendly)
- Custom templates

Mobile support depends on calendar source configuration.

---

## 🪪 License

MIT
