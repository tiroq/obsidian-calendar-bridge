# 04 — Note Rendering (Templates & AUTOGEN)

## 1. Template requirements
- The user selects one "meeting note template".
- The template supports placeholders of the form `{{var}}`.
- The template must contain AUTOGEN markers.

## 2. Placeholders (minimum)
- `title`
- `start_iso`, `end_iso`
- `start_human`, `end_human`
- `timezone`
- `calendar`
- `series_name`, `series_key`
- `location`, `conference_url`
- `attendees_yaml` (or markdown list)
- `agenda_block`, `joiners_block`, `links_block`

## 3. Agenda sources
Options (at series level or globally):
- `from_event_description`
- `from_series_profile`
- `static_default`

Rule:
- if the series has a profile agenda → it takes priority
- otherwise if the event has a description → it can be used as a seed
- otherwise empty list

## 4. Joiners block
- `@name <email>` per line
- separate required/optional (if available)
- add an "Unknown" field if attendees are unavailable

## 5. Rendering AUTOGEN blocks
When updating, the plugin:
- finds the marker boundaries
- replaces only the content between START/END
- if markers are missing — (a) does not touch the file, (b) outputs warning "template missing markers", (c) optionally offers to auto-insert

## 6. Frontmatter merge
Rule:
- the plugin is the "source of truth" for event metadata fields (start/end/status/urls)
- the user can add their own fields, and the plugin preserves them
- conflict: if the user manually changed start/end — the plugin can:
  - always overwrite
  - or respect the user override if the flag `manual_override: true` is set

## 7. Dry-run / Preview
"Preview plan" command:
- shows the list of files that will be created/modified
- provides a diff of AUTOGEN blocks (concise)

## 8. Date/time format localization
- the time format is set via a setting (e.g. `YYYY-MM-DD HH:mm`)
- timezone is taken:
  - from the event (if available)
  - otherwise from the plugin settings
