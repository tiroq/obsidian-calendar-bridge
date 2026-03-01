# Contributing

This guide covers development setup, project conventions, the Taskfile command reference, and the release process.

---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [npm](https://www.npmjs.com/) (bundled with Node.js)
- [Task](https://taskfile.dev/) (`brew install go-task` on macOS, or see [taskfile.dev](https://taskfile.dev/installation/))
- [GitHub CLI](https://cli.github.com/) (`gh`) — required for releases

### Clone and install

```bash
git clone https://github.com/tiroq/obsidian-calendar-bridge.git
cd obsidian-calendar-bridge
task install
```

### Development build (watch mode)

```bash
task dev
```

This starts esbuild in watch mode. `main.js` is rebuilt on every file change.

### Linking to an Obsidian vault for testing

Symlink the project root into your vault's plugins folder:

```bash
ln -s /path/to/obsidian-calendar-bridge \
      /path/to/your/vault/.obsidian/plugins/obsidian-calendar-bridge
```

Reload Obsidian and enable the plugin. Changes rebuild automatically with `task dev`.

---

## Taskfile Reference

All common development tasks are in `Taskfile.yml`. Run `task --list` to see all available tasks.

| Command | Description |
|---|---|
| `task install` | Install npm dependencies |
| `task dev` | Start esbuild in watch mode |
| `task test` | Run all Jest tests |
| `task test:watch` | Run Jest in watch mode |
| `task lint` | Run ESLint on `src/` |
| `task typecheck` | TypeScript type-check without emitting |
| `task build` | Production build (minified `main.js`) |
| `task ci` | Full CI pipeline: lint + typecheck + test + build |
| `task release:patch` | Bump patch version, build, commit, tag |
| `task release:minor` | Bump minor version, build, commit, tag |
| `task release:major` | Bump major version, build, commit, tag |
| `task gh-release` | Push tags + create GitHub release with assets |
| `task rel` | Alias for `gh-release` |

---

## Code Conventions

### No UI frameworks

The plugin uses Obsidian's native DOM API exclusively:

```typescript
// Correct
const el = containerEl.createEl('div', { cls: 'cb-panel' });
const btn = el.createEl('button', { text: 'Sync Now' });

// Wrong — no React, no Svelte, no innerHTML
```

### No separate CSS file

All styles use inline CSS via `el.style.*` or `el.setCssStyles()` with CSS variables for theming:

```typescript
el.style.color = 'var(--text-muted)';
el.style.backgroundColor = 'var(--background-secondary)';
```

### No type-error suppression

Never use `as any`, `@ts-ignore`, or `@ts-expect-error`. Fix the root type issue.

### UI contains no business logic

UI components (views, modals) call services and render state. They do not contain filtering, formatting, or sync logic.

### Logging rules

Never log:
- `client_secret`
- `access_token` or `refresh_token`
- Full ICS URLs for `ics_secret` sources
- Raw API response JSON

---

## Testing

Tests live in `tests/`. The test runner is Jest with `ts-jest`.

```bash
task test          # run once
task test:watch    # watch mode
```

The project uses an Obsidian mock at `tests/__mocks__/obsidian.ts`. When adding new Obsidian API calls, update the mock if needed.

**Target**: all new service code must have tests. UI code is tested manually via the development vault.

---

## Architecture Overview

```
src/
  main.ts                     ← Plugin entry, command registration, lifecycle
  types.ts                    ← All shared types and interfaces
  sync-manager.ts             ← Sync orchestrator (runSync)
  note-generator.ts           ← Note file creation/update, AUTOGEN blocks
  series-manager.ts           ← Series index page generation
  settings.ts                 ← Settings tab UI
  state/
    state-manager.ts          ← Subscriptions + cache persistence
  sources/
    gcal-source.ts            ← Google Calendar OAuth + event fetch
    ics-source.ts             ← ICS feed fetch + parse
  services/
    PlanningService.ts        ← Pure plan builder (fetch → plan)
    FilterService.ts          ← Event filtering with reason codes
    TemplateService.ts        ← CB slot injection and extraction
    TemplateRoutingService.ts ← 6-level template routing
    ContextService.ts         ← CB_CONTEXT slot: previous meeting summaries
    ActionAggregationService.ts ← CB_ACTIONS slot: carry-over actions
    MetricsService.ts         ← CB_DIAGNOSTICS: series health metrics
    DiagnosticsService.ts     ← Sync report accumulation
  modals/
    series-modal.ts           ← Series subscription manager
    preview-modal.ts          ← Sync preview
  views/
    panel/
      CalendarPanelView.ts    ← Calendar panel right sidebar view
```

### Sync pipeline

```
Sources → Fetch → Filter → Plan → Write → Report
```

Each stage logs its output count. A zero at any stage should produce a `zeroReason` in the sync report.

---

## Commit Conventions

Follow conventional commits:

| Prefix | Use for |
|---|---|
| `feat(scope):` | New user-visible feature |
| `fix(scope):` | Bug fix |
| `refactor(scope):` | Code change without behavior change |
| `test(scope):` | Adding or updating tests |
| `chore:` | Version bumps, build changes, tooling |
| `docs:` | Documentation only |

Examples:
```
feat(series): add hidden series toggle
fix(ics): handle missing TZID in VEVENT
chore: bump version to 1.12.0
docs: replace internal spec docs with user guides
```

---

## Release Process

Every meaningful unit of work should end with a published GitHub release.

### Version bump rules

| Change type | Version bump |
|---|---|
| Breaking change (removed/renamed public API, incompatible settings schema) | **major** |
| New user-visible feature, new command, new setting group | **minor** |
| Bug fix, UX improvement, refactor, docs update, dependency update | **patch** |

When in doubt: **patch**.

### Release steps

1. Determine bump type.
2. Run the appropriate Taskfile command:
   ```bash
   task release:patch   # or release:minor / release:major
   ```
   This bumps `package.json`, `manifest.json`, `versions.json`, builds `main.js`, commits, and tags.
3. Publish to GitHub:
   ```bash
   task rel
   ```
   This pushes tags and creates a GitHub Release with `main.js` and `manifest.json` attached.

### Manual release (if needed)

```bash
# 1. Bump version manually in package.json and manifest.json
# 2. Build
npm run build
# 3. Commit
git add package.json manifest.json versions.json main.js
git commit -m "chore: bump version to X.Y.Z"
git tag X.Y.Z
# 4. Push + release
git push origin main --tags
gh release create X.Y.Z main.js manifest.json \
  --title "vX.Y.Z — short description" \
  --notes "Changelog entry here."
```

Note: the Taskfile uses **bare version tags** (e.g. `1.12.0`), not `v1.12.0`.

---

## Related

- [Changelog](changelog.md) — version history
- [Troubleshooting](troubleshooting.md) — debugging sync issues
