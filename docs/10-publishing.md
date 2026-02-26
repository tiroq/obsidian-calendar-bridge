# 10 — Publishing (Community Plugin)

## 1. Repo structure
- `src/`
- `manifest.json`
- `package.json`
- `styles.css` (if needed)
- `README.md`
- `LICENSE`

## 2. Manifest requirements
- required fields (author, minAppVersion, version, id, name, description)
- correct `authorUrl` (must not be simply a link to the repo)
- GitHub Release tag must match `manifest.json version`

## 3. versions.json (if needed)
If `minAppVersion` is higher for some users:
- support `versions.json` for compatibility.

## 4. Submission checklist
- README describing sources (OAuth/ICS) and privacy risks
- clear install steps
- screenshots (settings + series select)
- no bundled secrets
- test on Windows/Mac/Linux

## 5. Licenses
- choose an OSS license (MIT/Apache-2.0)
- ensure dependencies are compatible

## 6. Store review tips
- stable settings schema
- clear error messages (OAuth failure, ICS fetch)
- do not make external network calls other than to the calendar source without explicit user consent
