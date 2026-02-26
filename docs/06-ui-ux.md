# 06 — UI/UX Spec

## 1. Main surfaces
1) Settings tab (primary)
2) Command palette commands
3) Modal "Select series"
4) Status bar (optional): last sync time / errors
5) Ribbon icon (optional): run sync

## 2. Commands
- `Meeting Notes: Sync next N days`
- `Meeting Notes: Preview sync plan`
- `Meeting Notes: Select/Manage series subscriptions`
- `Meeting Notes: Open series page (for current note)`
- `Meeting Notes: Create note for selected event` (manual mode)

## 3. Modal "Select series"
Section A: Upcoming events (grouped)
- shows series candidates, event count, nearest time
- enable checkbox
- quick actions:
  - set series name
  - set folder
  - set agenda source

Section B: Enabled series
- list of enabled series
- "Edit profile" button
- "Disable" button

## 4. Preview plan UI
- list of files to create/update
- brief explanation of "why" (new event / time changed / joiners updated)
- "Apply" button

## 5. Inline UX hints
When opening a meeting note:
- if it is a draft and start is within the next 2 hours:
  - show an unobtrusive notice "Meeting in X minutes"
- if status=cancelled:
  - notice "Cancelled"

## 6. Mobile UX
If OAuth on mobile is difficult:
- the plugin must be able to work in read-only mode with ICS
- or show guidance "OAuth available only on desktop; use ICS for mobile"
