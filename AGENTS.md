# obsidian-calendar-bridge — Agent Instructions

## MANDATORY: Release after completing work

After completing any meaningful unit of work, automatically determine the version bump, build, and publish a GitHub release. This is not optional.

---

## Version bump decision rules

| What changed | Bump |
|---|---|
| Breaking change — removed/renamed public API, changed settings schema in a non-backwards-compatible way | **major** (`X+1.0.0`) |
| New user-visible feature, new section, new command, new setting group | **minor** (`X.Y+1.0`) |
| Bug fix, UX improvement, refactor, copy change, dependency update, docs | **patch** (`X.Y.Z+1`) |

When in doubt, **patch**. Never skip the release.

---

## Release steps

1. Determine bump type from the table above
2. Bump version in **both** `package.json` and `manifest.json`
3. Run `npm run build` to rebuild `main.js`
4. Commit: `chore: bump version to X.Y.Z`
5. Tag: `git tag vX.Y.Z`
6. Push: `git push origin main --tags`
7. Create GitHub release with a changelog and attach assets:
   ```
   gh release create vX.Y.Z --title "vX.Y.Z — <short description>" --notes "<changelog>"
   gh release upload vX.Y.Z main.js manifest.json --clobber
   ```

**Every completed unit of work MUST end with a published GitHub release with `main.js` and `manifest.json` attached.**
