# 00 — Overview

## 1. Goal
An Obsidian plugin that:
- reads events from the user's calendar over a horizon of `N` days (default 3),
- allows "subscribing" to specific meeting series/types,
- creates **draft notes** in advance in the meetings folder using a template,
- adds a **recurring agenda**, list of potential attendees, and links,
- supports **series** cross-links (series index page, prev/next),
- does not break manual edits (idempotent generation).

## 2. Non-goals (important to keep scope contained)
- Full two-way sync note → calendar (creating/updating events) — not in v1.
- Automatic "smart" agenda based on LLM — not in core (can be an optional integration later).
- Universal aggregator of all calendars in the world — core is focused on Google Calendar, but the source layer is abstract.

## 3. Terms
- **Event** — an individual calendar event (instance).
- **Series** — a set of events considered as one series (e.g. recurring).
- **Draft note** — a note in Obsidian created in advance from a template.
- **AUTOGEN block** — sections of the note managed by the plugin (to avoid touching manual text).

## 4. Main user stories
1) As a user, I want to see a list of meetings for the next 3 days and enable autogen only for the series I need.
2) I want notes to be created in advance for enabled series, so I can fill them in real-time during a meeting.
3) I want meetings of the same series to be cross-linked and share a common "series page".
4) I want the plugin not to overwrite my notes entirely, but to update only the managed sections.

## 5. Quality Gates
- Idempotency: repeated runs do not create garbage and do not destroy manual text.
- Predictable file names and stable identifiers.
- Explicit privacy: the user understands what and where the plugin sends/stores.
- Fault tolerance: partial degradation (e.g. no attendees list) does not break note generation.

## 6. Compatibility requirements
- Desktop Obsidian (Windows/Mac/Linux) — mandatory.
- Mobile (iOS/Android) — desirable, but accounting for OAuth/network call limitations; may be "best-effort" in v1.
