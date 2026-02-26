# Calendar Bridge — Release & Publish Guide

## Prerequisites

- Node.js ≥ 18
- [Task](https://taskfile.dev) (`brew install go-task/tap/go-task` or `npm i -g @go-task/cli`)
- A GitHub repo with a `main` branch
- GitHub CLI (`gh`) for creating releases

---

## One-time setup

1. **Fork / create the repo** on GitHub.
2. **Set manifest fields** in `manifest.json`:
   - `author` — your name or handle
   - `authorUrl` — must be a URL that is NOT just the repo link (e.g. your personal site)
   - Confirm `id` is unique: check https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json
3. **Install dependencies**: `task install` (or `npm install`)

---

## Development workflow

```bash
task dev      # Start esbuild watcher (outputs to dist/)
task test     # Run all Jest tests
task lint     # Run ESLint on src/
task build    # Production build
```

---

## Release workflow

### 1. Update changelog (optional but recommended)

Document changes in `CHANGELOG.md`.

### 2. Bump version and tag

Choose the appropriate bump level:

```bash
task release:patch   # 1.0.0 → 1.0.1  (bug fixes)
task release:minor   # 1.0.0 → 1.1.0  (new features, backward-compatible)
task release:major   # 1.0.0 → 2.0.0  (breaking changes)
```

Each task:
1. Bumps version in `package.json`, `manifest.json`, and `versions.json`
2. Runs a production build
3. Commits `chore: bump version to X.Y.Z`
4. Creates and pushes a git tag `X.Y.Z`

### 3. Push to GitHub

```bash
git push origin main --tags
```

### 4. Create a GitHub Release

```bash
task gh-release
```

This runs `gh release create <version> --title "v<version>" --notes ""` and attaches:
- `main.js`
- `manifest.json`
- `styles.css` (if present)

Or create the release manually on GitHub with the same three files attached.

---

## Manual Installation (from GitHub Release)

Use this method to install without waiting for Obsidian Community Plugin approval,
or to install a specific version directly.

### Step-by-step

1. Go to the [Releases page](https://github.com/tiroq/obsidian-calendar-bridge/releases).
2. Open the latest release (or the version you want).
3. Under **Assets**, download:
   - `main.js`
   - `manifest.json`
4. In your Obsidian vault, create the plugin folder:
   ```
   <vault-root>/.obsidian/plugins/obsidian-calendar-bridge/
   ```
   > On macOS/Linux the `.obsidian/` folder may be hidden. Use `Cmd+Shift+.` in Finder or `ls -a` in terminal.
5. Copy both downloaded files into that folder.
6. Open Obsidian → **Settings → Community Plugins**.
   - If prompted, turn off **Restricted Mode**.
7. Find **Calendar Bridge** in the installed plugins list and enable it.
8. Configure at least one calendar source under **Settings → Calendar Bridge**.

### Updating manually

Repeat steps 1–5 with the new release files, then reload Obsidian (Ctrl/Cmd+R).

### Verifying the install

After enabling, open the command palette (Ctrl/Cmd+P) and search for `Calendar Bridge` —
you should see all five commands listed.

---


## First submission to the Obsidian Community Plugin list

1. Fork https://github.com/obsidianmd/obsidian-releases
2. Edit `community-plugins.json` — add your entry:
   ```json
   {
     "id": "obsidian-calendar-bridge",
     "name": "Calendar Bridge",
     "author": "Tiroq",
     "description": "Connect Google Calendar or ICS feeds and auto-generate structured meeting drafts.",
     "repo": "tiroq/obsidian-calendar-bridge"
   }
   ```
3. Open a PR to `obsidianmd/obsidian-releases`
4. The review team checks:
   - `manifest.json` has all required fields
   - No bundled secrets
   - README has install instructions and privacy disclosure
   - No unauthorized external network calls

### Submission checklist

- [ ] `manifest.json`: `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `authorUrl` all present and valid
- [ ] `authorUrl` is NOT simply a link to the repo
- [ ] `versions.json` present and maps `"1.0.0": "0.15.0"`
- [ ] `README.md` describes OAuth / ICS privacy risks
- [ ] `README.md` has clear install steps and screenshots
- [ ] No `.env`, credentials files, or secrets committed
- [ ] Tested on macOS, Windows, Linux (Obsidian desktop)
- [ ] GitHub Release tag matches `manifest.json` version exactly
- [ ] Release assets include `main.js` and `manifest.json`

---

## Privacy disclosure (include in README)

> **Privacy**: Calendar Bridge does not send any data to developer servers. OAuth tokens
> and secret ICS URLs are stored in plain text inside your Obsidian data directory.
> If you sync your vault to a shared or cloud location, enable **Redaction Mode** in
> Settings to prevent attendee emails and conference links from being written to notes.

---

## Updating an existing release

After passing community review, subsequent releases only require:

1. `task release:patch` (or `minor`/`major`)
2. `git push origin main --tags`
3. `task gh-release`

The Obsidian app fetches `manifest.json` and `versions.json` directly from the latest GitHub Release.
