# 09 — Testing Strategy

## 1. Unit tests
- normalize layer:
  - timezone parsing
  - seriesKey rules
- note renderer:
  - placeholder substitution
  - AUTOGEN replace
  - frontmatter merge

## 2. Integration tests
- ICS fetch with mocked HTTP (etag/last-modified)
- Google API with mocked responses (fixtures)

## 3. E2E scenarios
- create notes for next 3 days
- rerun sync → no duplicates
- user edits notes outside AUTOGEN → preserved
- event cancelled → status updated
- event moved time → start/end updated and optionally file moved

## 4. Regression suite (edge-cases)
List from `11-edge-cases.md` as test cases.

## 5. CI
- lint + typecheck
- unit tests
- build plugin artifacts
