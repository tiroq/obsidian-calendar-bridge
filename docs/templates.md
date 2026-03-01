# Templates

Calendar Bridge uses a **slot-based template system**. You write your own note template and place slot markers where you want the plugin to inject managed content. Everything outside slot markers is yours — it is never modified.

---

## How Templates Work

1. You create a Markdown file in your vault (e.g. `_templates/meeting.md`).
2. Set `templatePath` in settings to point to it.
3. On the first sync for an event, Calendar Bridge copies the template and fills all slot markers with generated content.
4. On subsequent syncs, only the content inside slot markers is updated. Your notes in between are untouched.

---

## CB Slots

CB slots are the primary extension points for Calendar Bridge. Each slot is a pair of HTML comment markers:

```markdown
<!-- CB:BEGIN SLOT_NAME -->
(content managed here)
<!-- CB:END SLOT_NAME -->
```

**Rules:**
- Do not edit content inside slot markers manually — it will be overwritten on next sync.
- You can reorder slots in your template freely.
- Omit any slot you don't want — Calendar Bridge skips it.

### Slot Reference

| Slot | Purpose | Populated by |
|---|---|---|
| `CB_FM` | Frontmatter additions/overrides | Template (static values merged into FM) |
| `CB_HEADER` | Note title and time block at top | Sync engine (event title + formatted times) |
| `CB_LINKS` | Conference and series navigation links | Sync engine (Meet/Zoom/Teams URLs + series page link) |
| `CB_CONTEXT` | Summary context from the 3 most recent meetings in the series | `ContextService` (recurring events only) |
| `CB_ACTIONS` | Carry-over open actions from the last 5 meetings in the series | `ActionAggregationService` (recurring events only) |
| `CB_BODY` | Main body area (agenda, notes, attendees) | Template (your content here) |
| `CB_DECISIONS` | Decisions section | Template (your content here) |
| `CB_DIAGNOSTICS` | Plugin health metrics for the series | `MetricsService` (series index pages only) |
| `CB_FOOTER` | Footer area | Template (your content here) |

### CB_CONTEXT

When the event is part of a recurring series and previous meeting notes exist in the vault, `CB_CONTEXT` is populated with a brief summary of the last 3 meetings — including titles, dates, and key excerpt. Use this to quickly recall what happened last time without leaving the note.

### CB_ACTIONS

`CB_ACTIONS` scans the last 5 notes in the series for open action items (lines starting with `- [ ]`). Carry-over actions are injected so nothing falls through the cracks.

### CB_DIAGNOSTICS

`CB_DIAGNOSTICS` is only injected into series index pages (not individual meeting notes). It contains a health table showing meeting cadence, note coverage, and sync activity metrics for the series.

---

## Minimal Template Example

```markdown
---
type: meeting
draft: true
---

<!-- CB:BEGIN CB_HEADER -->
<!-- CB:END CB_HEADER -->

<!-- CB:BEGIN CB_LINKS -->
<!-- CB:END CB_LINKS -->

<!-- CB:BEGIN CB_CONTEXT -->
<!-- CB:END CB_CONTEXT -->

<!-- CB:BEGIN CB_ACTIONS -->
<!-- CB:END CB_ACTIONS -->

## Notes

(Your notes here)

## Decisions

<!-- CB:BEGIN CB_DECISIONS -->
<!-- CB:END CB_DECISIONS -->
```

---

## AUTOGEN Blocks (Legacy)

AUTOGEN blocks are an older format still supported for backwards compatibility. They use a different marker syntax:

```markdown
<!-- AUTOGEN:AGENDA:START -->
- Sprint updates
- Blockers
<!-- AUTOGEN:AGENDA:END -->

<!-- AUTOGEN:JOINERS:START -->
- Alice (alice@example.com)
<!-- AUTOGEN:JOINERS:END -->
```

Supported AUTOGEN block types:

| Block | Content |
|---|---|
| `AUTOGEN:AGENDA:START/END` | Auto-generated agenda items from the event description |
| `AUTOGEN:JOINERS:START/END` | Attendee list extracted from the event |

> **Recommendation**: Prefer CB slots for new templates. AUTOGEN blocks remain supported but will not receive new features.

---

## Template Routing

Template routing lets you assign different templates to different meetings based on a 6-level priority chain.

### Priority (highest → lowest)

| Priority | Match type | Example |
|---|---|---|
| 1 | **Series key** exact match | `gcal:abc123xyz` |
| 2 | **Calendar ID** exact match | `team@company.com` |
| 3 | **Title regex** match | `(?i)standup` |
| 4 | **Attendee domain** match | `company.com` |
| 5 | **Tag** match | `engineering` |
| 6 | **Global default** | `templatePath` setting |

The first route that matches the event wins. If no route matches, the global default template is used.

### Configuring routes

Routes are configured in **Settings → Calendar Bridge → Template Routes**. Each route specifies:

- **Match type** — which of the 6 levels to use
- **Match value** — the series key, calendar ID, regex, domain, or tag to match
- **Template path** — vault path to the template to use

### Series-level template override

You can also set a template override per series directly in the Series Manager. This is equivalent to a series-key route and takes priority over all other routes.

---

## Frontmatter

Calendar Bridge writes the following frontmatter fields to every meeting note:

| Field | Value |
|---|---|
| `type` | `meeting` |
| `title` | Sanitized event title |
| `start` | ISO 8601 start datetime with timezone offset |
| `end` | ISO 8601 end datetime with timezone offset |
| `series_key` | Stable series identifier (e.g. `gcal:abc123`) |
| `draft` | `true` until you remove it |
| `status` | `cancelled` if the event was cancelled in the calendar |

Your template can add additional static frontmatter fields. Fields you add are preserved and never overwritten.

---

## Related

- [Configuration Reference](configuration.md) — `templatePath` and `templateRoutes` settings
- [Series Management](series.md) — `CB_CONTEXT`, `CB_ACTIONS`, `CB_DIAGNOSTICS` in context
