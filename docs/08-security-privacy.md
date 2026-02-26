# 08 — Security & Privacy

## 1. Principle
The plugin must not send user data to third-party servers belonging to the developer. All processing is local, except for requests to the selected calendar source.

## 2. Google OAuth risks
- Access/refresh tokens are sensitive.
- Storage:
  - use secure storage where available (OS keychain) — preferred
  - otherwise — encrypted storage (implementation to be discussed; non-trivial in Obsidian/Electron)
  - minimum: store in the plugin data folder and explicitly warn the user

## 3. Scopes
Minimum:
- read-only calendar access (events read only)

Do NOT request:
- write scopes
- access to Gmail/Drive etc.

## 4. ICS secret link
- treat as a secret (like a password)
- show a warning in settings
- do not log the full URL
- "mask URL" option in the UI

## 5. Logs and telemetry
- by default — no telemetry
- debug logs are local and user-controlled
- sanitization: do not write attendee emails without the "verbose" flag

## 6. Threat model (minimum)
- token leak (calendar access)
- ICS secret URL leak
- notes saved in a git/public repo

Mitigations:
- clear docs
- UI warnings
- "redaction mode" (do not write attendees/links) — optional
