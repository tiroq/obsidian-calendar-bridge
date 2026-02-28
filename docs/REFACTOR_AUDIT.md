# Refactor Audit — Calendar Bridge

**Date**: 2026-03-01  
**Version**: v1.8.0

---

## Purpose

This document records the findings of a codebase duplication audit conducted as part of the v1.8.0 reliability release. For each duplication found, the resolution is noted.

---

## Audit Findings

### 1. Filter logic — RESOLVED

**Before**: Event-filtering predicates (all-day, declined, duration, title patterns) were duplicated between `PreviewSection.ts` and internal sync-manager pre-filtering.

**After**: Extracted to `src/services/FilterService.ts` with two exports:
- `getExclusionReason(event, filters): string | null` — single-event reason
- `applyFilters(events, filters): FilterResult` — batch with counts

`PreviewSection.ts` now calls `applyFilters` directly. No other file duplicates these predicates.

**Tests**: `tests/filter-service.test.ts` (49 cases).

---

### 2. Sync diagnostics — RESOLVED

**Before**: No structured representation of sync pipeline stages. `triggerSync()` in `main.ts` built ad-hoc Notice strings inline. The panel had no way to display what happened at each stage.

**After**: `src/services/DiagnosticsService.ts` converts `SyncResult` → `SyncReport` and stores the last 10 reports in memory. `main.ts` calls `recordSyncResult(result, startedAt)` after every `runSync()`. The panel's `DebugSection` reads `getLastSyncReport()` via the plugin interface.

**Tests**: `tests/diagnostics-service.test.ts` (25 cases).

---

### 3. `runSync` call pattern — PARTIAL DUPLICATION (acceptable)

**Observation**: `triggerSync()`, `triggerSyncWithProgress()`, `fetchNormalizedEvents()`, `computeSyncPlan()`, and `applyPlan()` in `main.ts` each call `runSync()` with slightly different arguments.

**Decision**: Not extracted. Each call site has a distinct contract (with/without progress, dry-run vs. write, preview vs. apply). Introducing a shared wrapper would obscure the differences without reducing real duplication. The shared pattern is `buildIsSeriesEnabled()` and `selectedCalendarIds` resolution — both already extracted to helpers that every call site reuses.

---

### 4. `selectedCalendarIds` resolution — RESOLVED (existing)

The pattern `settings.sources.find(s => s.sourceType === 'gcal_api' && s.enabled)` was repeated at every `runSync` call site. It is now encapsulated in `buildIsSeriesEnabled()` (for the series gate) and the `gcalSource` local variable is resolved once per call site before calling `runSync`. No further extraction is needed.

---

### 5. `ensureFolderExists` — SINGLE IMPLEMENTATION

Only one copy exists in `sync-manager.ts`. Not duplicated elsewhere.

---

### 6. Template filling — SINGLE IMPLEMENTATION

`fillTemplateNormalized()` in `note-generator.ts` is the sole template-fill entry point. No duplication found.

---

### 7. Panel section `destroy()` pattern — ACCEPTABLE REPETITION

Each panel section class implements `destroy()` to remove event listeners and clear DOM. The pattern is structurally similar across sections but each section manages different resources. A base class would add complexity without meaningful reduction. Left as-is.

---

## Remaining Opportunities (Not Blocking)

| Item | Priority | Notes |
|---|---|---|
| `selectedCalendarIds` resolution could be a `getGcalSourceConfig()` helper on the plugin | Low | Only 5 call sites; readable as-is |
| `btnStyle` CSS string in `StatusHeader.ts` repeated per button | Low | 4 buttons; a shared constant would help if buttons grow |
| Series key computation in `gcal-source.ts` and `ics-parser.ts` | Low | Already delegates to `computeSeriesKey()` in `adapter.ts` — already resolved |

---

## Conclusion

The major duplication vectors (filter logic, diagnostics) have been resolved. Remaining repetitions are either intentional (distinct call sites) or cosmetically minor. The codebase is in a disciplined state for v1.8.0.
