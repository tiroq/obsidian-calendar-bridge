# obsidian-calendar-bridge — Agent Instructions

## MANDATORY: Release after completing work

After completing any meaningful unit of work (bug fix, feature, improvement):

1. Bump the patch version in `package.json` AND `manifest.json` (e.g. `1.2.16` → `1.2.17`)
2. Run `npm run build` to rebuild `main.js`
3. Commit: `chore: bump version to X.Y.Z`
4. Tag: `git tag vX.Y.Z`
5. Push: `git push origin main --tags`
6. Create GitHub release with assets:
   ```
   gh release create vX.Y.Z --title "vX.Y.Z — <short description>" --notes "<changelog>"
   gh release upload vX.Y.Z main.js manifest.json --clobber
   ```

**This is not optional.** Every completed patch MUST end with a published GitHub release with `main.js` and `manifest.json` attached.
