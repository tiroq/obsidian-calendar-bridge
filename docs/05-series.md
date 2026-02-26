# 05 — Series Management & Cross-links

## 1. Series subscriptions (main UX feature)
The user must be able to:
- see series candidates within the horizon
- enable autogen per series
- configure overrides per series (template, folder, agenda, tags)

## 2. Defining a "series"
SeriesCandidate = group(events by seriesKey)
Display field:
- seriesName = (best-effort) normalized name:
  - if recurring: take the summary of the master event (if available)
  - otherwise: common prefix heuristic

## 3. Series Profile
For each series, the following is stored:
- enabled (bool)
- seriesName (string)
- noteFolderOverride (optional)
- templateOverride (optional)
- defaultAgenda (markdown list)
- tags (list)
- joinersOverrides:
  - pinned (always include)
  - hidden (do not show)

## 4. Series Page generation
If enabled:
- file: `Meetings/_series/<slug(seriesName)>.md`
- contains:
  - series description (manual, do not touch)
  - AUTOGEN: list of meetings

AUTOGEN meeting list block:
- grouped by month
- links to notes
- statuses (cancelled)

## 5. Prev/Next links
Optional setting.
Algorithm:
- sort series events by start
- for each instance determine prev/next within the available window
- write to AUTOGEN:LINKS block:
  - `Prev: [[...]]`
  - `Next: [[...]]`
  - `Series: [[...]]`

## 6. "Mark series" via Obsidian itself (alternative to UI)
The plugin can support a command:
- `Enable series for current note`
which:
- reads seriesKey from frontmatter
- enables the subscription

## 7. Series without recurring
Even if events are not recurring, the user can group them into a "virtual series":
- matching rule (title contains / location / attendees / calendar)
- stored as `virtualSeriesKey = "rule:<id>"`

This is v1.1 (optional), to avoid bloating the MVP.
