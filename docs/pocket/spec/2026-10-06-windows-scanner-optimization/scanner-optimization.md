# Windows Scanner Performance, UX, and Profile Optimization

**Date:** 2026-10-06
**Status:** approved
**Author:** pocket-pitching + pocket-grinding session
**Spec path:** docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md

---

## Summary

This specification defines improvements to the Cleanup Web Scanner to optimize scan performance, ensure robust Windows user profile resolution across native and Docker environments, provide a clean professional UI by filtering non-existent folders (`not_found`), and add streaming progress feedback without adding external dependencies.

---

## Context

### Current State
- The backend scans allowlisted whitelist roots sequentially via `walkFolder()`, performing sequential `lstat` calls per file.
- Non-existent directories are marked `not_found`, but are rendered as full cards in the UI, cluttering the view for general users.
- Profile resolution uses registry querying (`HKCU\...\User Shell Folders`) with fallbacks.
- UI rendering lacks default filtering for missing folders and live streaming progress updates.

### Problem / Motivation
- Users on standard Windows profiles or fresh setups see multiple "not_found" entries, which looks unpolished.
- Sequential `lstat` and deep directory traversal on large caches (like Prefetch or npm-cache) cause noticeable scan duration.
- Docker bind mounts add filesystem overhead, making efficient traversal and timeout budgeting critical.

### Related Areas
- `server.js` (`walkFolder`, `scanFolder`, `scanAll`)
- `lib/resolve-temp.js` (`resolveUserPaths`, `queryLocalAppData`)
- `public/app.js` (UI render, filters, preferences)
- `tests/` (all integration and unit tests)

---

## Scope

### In-Scope
- Hide `not_found` folders by default in UI with a reveal chip (clicking reveals them; `access_denied` and `partial` remain visible).
- Fallback paths (e.g. `C:\Temp` when profile resolution fails) are exempt from `hideNotFound` so users see actionable warnings on first run.
- Empty state message alongside reveal chip when all scanned folders are `not_found`.
- Robust Windows user profile resolution across native registry queries and Docker environment variables (`HOST_USER`, `SCAN_HOST_MOUNT`).
- Custom zero-dependency bounded concurrency pool (e.g., max 32 concurrent operations) in `walkFolder()` to reduce wall-clock time without violating project constraints.
- Global shared timeout budget across folders: when `SCAN_TIMEOUT_MS` expires, scan enforces strict deadline stop — remaining unstarted or active folders immediately return status `partial` with reason `timeout`.
- Server-Sent Events (SSE) streaming progress endpoint (`/api/scan/stream`) with fallback to standard `GET /api/scan`.

### Out-of-Scope
- Changing cleanup safety rules, allowlists, or `cleanup-targets.js`.
- Promising arbitrary performance speedup percentages without specific benchmark hardware.
- Supporting legacy/unsupported Windows versions.
- Making `access_denied` or `partial` statuses hideable by filters.

---

## Architecture Constraints

- **May touch:** `server.js`, `lib/resolve-temp.js`, `public/app.js`, tests.
- **Must NOT touch:** `lib/cleanup-engine.js` safety rules, `lib/cleanup-targets.js` registry, API contracts for cleanup execution.
- **Must follow:** Zero new dependencies (vanilla JS/Node.js), `requestId` deduplication, `onProgress` callback pattern, strict read-only safety.
- **Status guarantee:** `access_denied` and `partial` are permanently visible.

---

## Dependencies

### Existing (to leverage)
- Node.js builtin modules (`fs/promises`, `path`, `node:child_process`, `node:events`).

### New (proposed)
- **None.** Zero dependencies maintained. Concurrency pool is custom-built lightweight vanilla JS.

---

## Stories + Scenarios

### Story 1: Smart Filter of Missing Folders (not_found)
> As a **general Windows user**, I want **folders that do not exist on my system to be hidden by default**, so that **the scan results look clean and I only see actionable folders**.

```gherkin
Scenario: Happy path — not_found folders hidden by default
  Given the scanner returns 18 entries including 4 with status "not_found"
  When the results render
  Then only 14 entries are visible in the grouped list
  And the chip "4 folder disembunyikan (tidak ditemukan)" is shown
  And no "not_found" badge appears in the visible list

Scenario: Toggle chip reveals hidden not_found entries
  Given the chip "4 folder disembunyikan (tidak ditemukan)" is visible
  When the user clicks the chip
  Then all 18 entries are visible
  And the 4 entries show status badge "Tidak ditemukan"
  And the chip disappears

Scenario: access_denied and partial are never hidden
  Given the scanner returns 2 "not_found", 1 "access_denied", 1 "partial"
  When results render with default filter
  Then the 2 "not_found" are hidden
  And the 1 "access_denied" and 1 "partial" remain visible with their reason badges

Scenario: Fallback missing path is exempt from hiding
  Given native profile resolution fails and falls back to missing "C:\Temp" (status not_found)
  When results render with default hideNotFound=true
  Then the fallback entry remains visible with a warning badge instead of being hidden

Scenario: Empty state when all entries are not_found
  Given hideNotFound is true and all scanned folders return not_found
  When results render
  Then a clear empty state message is displayed alongside the reveal chip
```

### Story 2: Dynamic Windows Profile Resolution (Native + Docker)
> As a **user on any Windows profile**, I want **the scanner to automatically find my actual %LOCALAPPDATA% and %TEMP% paths**, so that **it works seamlessly on first run**.

```gherkin
Scenario: Native — standard profile resolved from registry
  Given running native on Windows as user "Budi"
  When resolveUserPaths() executes
  Then localAppData = "C:\Users\Budi\AppData\Local"
  And temp = "C:\Users\Budi\AppData\Local\Temp"
  And the whitelist entry "Local\Temp" points to that path

Scenario: Native — profile with space in name
  Given running native as user "John Doe"
  When resolveUserPaths() executes
  Then temp path contains "John Doe" exactly

Scenario: Docker — HOST_USER mapped and remapped
  Given docker compose with HOST_USER=jane and SCAN_HOST_MOUNT={"c":"/mnt/c"}
  When scan runs inside container
  Then the container path for "Local\Temp" is "/mnt/c/Users/jane/AppData/Local/Temp"
  And the displayPath shown to user remains "C:\Users\jane\AppData\Local\Temp"
```

### Story 3: Scan Progress Feedback & Shared Timeout Budget
> As a **user waiting for scan**, I want **incremental progress and robust timeout handling**, so that **large folders don't block everything and the wait feels responsive**.

```gherkin
Scenario: UI shows incremental folder results
  Given scan starts with 22 folders
  When folder "Local\Temp" completes
  Then the card for "Local\Temp" appears immediately with size and status
  And overall progress advances

Scenario: Strict deadline timeout stops scan
  Given SCAN_TIMEOUT_MS=45000 and a massive folder consumes the entire budget
  When global timeout expires
  Then scan stops immediately
  And any remaining unstarted folders receive status "partial" with reason "timeout"
  And results return promptly without hanging
```

### Story 4: Scan Engine Bounded Concurrency (Zero Deps)
> As a **maintainer**, I want **walkFolder traversal to use a custom bounded concurrency pool for lstat**, so that **scan time is reduced without adding external dependencies**.

```gherkin
Scenario: Concurrency reduces wall-time without changing semantics
  Given a folder with 20,000 small files
  When walkFolder runs with custom concurrency pool (max 32 concurrent lstats)
  Then wall-time is reduced compared to sequential walk
  And fileCount, sizeBytes, skipped, partial are identical to sequential run
```

---

## Acceptance Criteria

```
Rule: Missing folders hidden by default
  ✓ Given 4 not_found entries, When rendered with hideNotFound=true, Then hidden chip shows and entries are omitted
  ✓ Given hidden chip clicked, When toggled, Then all entries appear
  ✗ Given access_denied entry, When rendered, Then it is never hidden by filter

Rule: Profile resolution & Fallback exemption
  ✓ Given valid registry, When resolveUserPaths runs, Then correct user AppData path is used
  ✓ Given resolution failure falling back to C:\Temp (not_found), When rendered, Then fallback entry remains visible with warning

Rule: Concurrency and Timeout
  ✓ Given file-heavy directory, When walkFolder runs with bounded concurrency, Then correct counts are returned faster
  ✓ Given strict global timeout budget, When total budget expires, Then active and unstarted folders become partial/timeout and results return promptly
```

---

## Design Decision

**Chosen option:** Option A (Smart UI Filtering + Custom Bounded Concurrency + SSE/Polling Hybrid + Robust Profile Fallback exemption).

**Summary:** Combines zero-dependency concurrency pooling in `walkFolder`, robust profile resolution with fallback exemption, UI filtering for `not_found` with a reveal chip, and shared global timeout budgeting.

**Rejected options:**
- Option B (Adding `p-limit` library): rejected to uphold the strict zero-dependency architectural constraint.
- Option C (Static per-folder timeout): rejected because it starves large folders like Prefetch.

**Key tradeoffs accepted:**
- Custom concurrency pool requires writing ~25 lines of promise management logic, but keeps dependencies at zero.

---

## Open Questions / Assumptions

| Resolution | Risk if Wrong |
|------------|---------------|
| assumed: SSE endpoint falls back gracefully to standard `GET /api/scan` if event-source fails | Minor UI fallback to polling/once-fetch |

---

## Rollback Plan

- Disable feature flag or revert commit; fallback to sequential `walkFolder` and un-filtered UI render.
