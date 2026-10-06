# EXECUTION PLAN — Windows Scanner Performance, UX, and Profile Optimization

**Date:** 2026-10-06
**Spec:** docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
**Status:** draft
**Total tasks:** 7

---

## Execution Overview

### Recommended Order
```
Tier 0 (prereq, parallel): T1, T3, T5
Tier 1 (after T1):         T2 [test-risk]
Tier 2 (after T2):         T4 [test-risk]
Tier 3 (after T3,T5):      T6
Tier 4 (after T4,T5):      T7 [test-risk]
```

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T1, T3, T5 | start |
| Group B | T6 | T3, T5 |
| Group C | T7 | T4, T5 |

### Constraints Reminder
**Architecture:** Zero new dependencies (Node builtins + vanilla JS only). May touch `server.js`, `lib/resolve-temp.js`, `public/app.js`, and tests. MUST NOT touch `lib/cleanup-engine.js` or `lib/cleanup-targets.js` safety logic.
**Out-of-scope:** cleanup rules/allowlist changes, arbitrary speedup-percentage promises, legacy Windows support, making `access_denied`/`partial` hideable.
**Assumptions at risk:** SSE client falls back to `GET /api/scan` if EventSource is unavailable — if wrong, scan still works but without streaming.
**Sequencing:** Dependency order is recommended only — pocket enforces actual blocking rules.

### File Structure Map

```
Rule: Missing folders hidden by default
  Modify: public/app.js
  Test:   tests/public.test.js

Rule: Fallback exemption (C:\Temp visible with warning)
  Modify: server.js (getWhitelist / makeEntry fallback marker)
  Modify: public/app.js
  Test:   tests/server.test.js, tests/public.test.js

Rule: Dynamic Windows profile resolution
  Modify: lib/resolve-temp.js
  Test:   tests/resolve-temp.test.js, tests/scan-roots.test.js

Rule: Strict global deadline timeout + progress
  Modify: server.js (scanAll / walkFolder)
  Test:   tests/server.test.js

Rule: Bounded concurrency walk
  Create: lib/concurrency.js        (created by: T1)
  Modify: server.js (walkFolder)
  Test:   tests/concurrency.test.js, tests/server.test.js

Rule: SSE streaming progress
  Modify: server.js (/api/scan/stream route)
  Modify: public/app.js (EventSource client + fallback)
  Test:   tests/server.test.js, tests/public.test.js
```

---

## Pocket Packets

---

### Task 1: Bounded concurrency helper module [prereq]

## OBJECTIVE
Create a zero-dependency bounded-concurrency map helper used by the scan walker.

Steps:
1. Write failing test for: bounded concurrency + order preservation
   Test file: `tests/concurrency.test.js`
   Level: unit
   Test intent: Given an array of 20 items and limit 4, When `mapLimit` runs an async mapper, Then the number of simultaneously in-flight mapper calls never exceeds 4, and results preserve input order.
   Exercise through: exported `mapLimit(items, limit, mapper)` public function
   Test doubles: instrument the mapper with a counter (no fs, no timers beyond resolved promises)
   Expected RED: `lib/concurrency.js` does not exist yet → import fails / function undefined.
2. Run test — verify FAIL: `node --test tests/concurrency.test.js`
3. Write failing test for: edge cases
   Test file: `tests/concurrency.test.js`
   Level: unit
   Test intent: Given an empty array, When `mapLimit` runs, Then it resolves `[]`; Given `limit` greater than item count, Then all items run; Given a mapper that rejects on one item, Then the returned promise rejects and no unhandled rejection escapes.
   Exercise through: same exported `mapLimit`
   Test doubles: none
   Expected RED: same missing module.
4. Run test — verify FAIL: `node --test tests/concurrency.test.js`
5. Implement `lib/concurrency.js` (cursor-based worker pool, `'use strict'`, CommonJS `module.exports = { mapLimit }`) until both cycles pass.
6. Refactor while green; commit: `feat(lib): add zero-dependency bounded concurrency helper`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 4: "Concurrency reduces wall-time without changing semantics"

## WHY THIS APPROACH
Complexity: lightweight
Justification: Single small module, clear contract, no cross-file judgment.

## SANDWICH CONTEXT
[CRITICAL: Zero new dependencies — Node builtins + vanilla JS only]
You are implementing a reusable concurrency helper for the Windows scanner optimization.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — custom zero-dependency bounded concurrency pool.
Files in scope: `lib/concurrency.js` (create), `tests/concurrency.test.js` (create)
Available after: none (prereq)
Architecture rule: follow existing CommonJS module conventions (`'use strict'`, `module.exports` object).
[RESTATE: Zero new dependencies — do not add p-limit or any npm package]

## DELIVERABLE
Given 20 items and limit 4, When `mapLimit` runs, Then max in-flight ≤ 4 and order preserved.
Given an empty array, When `mapLimit` runs, Then it resolves `[]`.
[must-not] Given any input, When `mapLimit` runs, Then it must NOT add an external dependency.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - `mapLimit` exported and independently unit-testable
  - Conventional commit message
Must-not-have:
  - Any npm dependency
  - Generic `utils.js` naming (module is domain-scoped: concurrency)
Open question risks:
  - None
Rollback note:
  - Delete `lib/concurrency.js`; no other file imports it until T2.
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Dependency added → STOP

## STOP CONDITIONS
Done when: both RED cycles pass, no out-of-scope files modified
Uncertain when: limit semantics ambiguous
Escalate when: constraint violated

---

### Task 2: walkFolder bounded concurrency, dirent reuse, strict deadline regression [depends: T1] [test-risk]

## OBJECTIVE
Replace sequential per-entry `lstat` in `walkFolder` with `mapLimit`, reuse `dirent` type info to skip unnecessary `lstat`, and ensure strict-deadline prompt return is preserved.

Steps:
1. Write failing test for: semantics identical under concurrency
   Test file: `tests/server.test.js`
   Level: integration (exercises exported `walkFolder` over a real temp fixture)
   Test intent: Given a fixture directory tree with a known file count/size, When `walkFolder` runs with bounded concurrency, Then `{ fileCount, sizeBytes, skipped, timedOut, partial }` equals the sequential baseline for the same tree.
   Exercise through: exported `walkFolder(rootPath, context)`
   Test doubles: inject a counting `context.fs` that wraps `fs.promises` to observe in-flight `lstat` calls
   Expected RED: current `walkFolder` executes sequential `lstat` calls; in-flight concurrency assertion (≤ limit) fails.
2. Run test — verify FAIL: `node --test tests/server.test.js`
3. Write failing test for: dirent type reuse avoids type-only lstat
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given a directory with 100 files and 20 subdirectories, When `walkFolder` runs with `dirent.isFile()`/`dirent.isDirectory()` available, Then the number of `lstat` calls equals the number of files (no lstat for type-only directory entries).
   Exercise through: exported `walkFolder(rootPath, context)`
   Test doubles: injected `context.fs` that counts `lstat` calls per path
   Expected RED: current `walkFolder` calls `lstat` for every entry including directories → lstat count equals 120 instead of 100.
4. Run test — verify FAIL: `node --test tests/server.test.js`
5. Write failing test for: strict deadline prompt return
   Test file: `tests/server.test.js`
   Level: unit (walkFolder directly)
   Test intent: Given `context.startedAt` already ≥ `context.timeoutMs` before `walkFolder` is called, When `walkFolder` runs, Then it returns immediately with `{ fileCount:0, sizeBytes:0, skipped:0, timedOut:true, partial:true }` without issuing any filesystem readdir or lstat call.
   Exercise through: exported `walkFolder(rootPath, context)`
   Test doubles: injected `context.now()` returning `startedAt + timeoutMs`, injected `fs` throwing if `readdir` is invoked
   Expected RED: current `walkFolder` enters the while loop and executes `readdir` before the loop-body `hasTimedOut` check → throws error from fs stub instead of returning immediately.
6. Run test — verify FAIL: `node --test tests/server.test.js`
7. Implement in `server.js`: check `hasTimedOut` before the initial `readdir` and inside the loop; use `mapLimit` from `lib/concurrency.js` for the per-directory entry loop; use `dirent.isFile()`/`dirent.isDirectory()` to avoid a type-only `lstat` (still `lstat` for size where required). Preserve `skipped` accounting and the `skipRatio > 0.10 → partial` rule exactly.
8. Refactor while green; commit: `perf(server): bounded-concurrency walkFolder with strict deadline`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 3 (strict deadline), Story 4 (concurrency); Rule: "Concurrency and Timeout"

## WHY THIS APPROACH
Complexity: standard
Justification: Touches the hot path with behavioral invariants (skip ratio, partial status) that must not regress. Concurrency and timeout materially change test strategy → [test-risk] marker.

## SANDWICH CONTEXT
[CRITICAL: `access_denied` and `partial` semantics must remain identical to today]
You are optimizing the scan walker in `server.js`.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — bounded concurrency + strict deadline.
Files in scope: `server.js` (`walkFolder`, `scanAll`), `tests/server.test.js`
Available after: T1 (`lib/concurrency.js` exists)
Architecture rule: no new dependencies; keep `hasTimedOut`/`skipRatio` logic semantics intact.
[RESTATE: never hide or reclassify `access_denied`/`partial`; strict deadline returns promptly]

## DELIVERABLE
Given a fixture tree, When `walkFolder` runs concurrently, Then counts/size/skipped/partial match the sequential baseline.
Given in-flight lstat instrumentation, When `walkFolder` runs, Then max concurrent lstat ≤ configured limit.
Given `dirent` type info available, When `walkFolder` walks, Then `lstat` is called only for files (not directories) for type determination.
Given the global deadline has already elapsed before `walkFolder` is called, When `walkFolder` runs, Then it returns immediately with `timedOut=true, partial=true` and zero fs calls.
[must-not] Given a skip ratio > 0.10, When walking, Then the folder must NOT be reported `ready`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - Identical `{fileCount,sizeBytes,skipped,timedOut,partial}` vs baseline
  - Bounded in-flight lstat (limit honored)
  - `lstat` only for files when `dirent` type is available
  - Conventional commit
Must-not-have:
  - Changes to `lib/cleanup-engine.js` or `lib/cleanup-targets.js`
  - Flaky wall-clock timing assertions in CI (assert bounded concurrency + identical results instead; note any wall-time benchmark as manual/non-CI)
Open question risks:
  - Concurrency limit default (assumed 32) → if wrong, report NEEDS_CONTEXT
Rollback note:
  - Revert `server.js` walkFolder to the sequential loop; `lib/concurrency.js` becomes unused.
Red flags:
  - Skip-ratio or partial behavior changed → STOP
  - Out-of-scope files touched → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass and all existing server tests stay green
Uncertain when: concurrency default disputed
Escalate when: access_denied/partial semantics change

---

### Task 3: Profile resolution hardening + fallback marker [prereq]

## OBJECTIVE
Guarantee correct `%LOCALAPPDATA%`/`%TEMP%` resolution across native and Docker profiles, and expose a `usedFallback` marker so the UI can keep unresolved fallback entries visible.

Steps:
1. Write failing test for: space-in-username profile resolution
   Test file: `tests/resolve-temp.test.js`
   Level: unit
   Test intent: Given a registry query returning `C:\Users\John Doe\AppData\Local`, When `resolveUserPaths` runs, Then `localAppData` is `C:\Users\John Doe\AppData\Local` and `temp` is `C:\Users\John Doe\AppData\Local\Temp` with space preserved.
   Exercise through: exported `resolveUserPaths(queryFn)`
   Test doubles: injected `queryFn` returning `C:\Users\John Doe\AppData\Local`
   Expected RED: test asserts `{ localAppData, temp, usedFallback }` output contract; current `resolveUserPaths` returns only `{ localAppData, temp }` without `usedFallback` field.
2. Run test — verify FAIL: `node --test tests/resolve-temp.test.js`
3. Write failing test for: fallback path reports usedFallback=true
   Test file: `tests/resolve-temp.test.js`
   Level: unit
   Test intent: Given registry query throws and `LOCALAPPDATA` and `TEMP` env vars are deleted, When `resolveUserPaths` runs, Then `temp` equals `C:\Temp` and `usedFallback` equals `true`.
   Exercise through: exported `resolveUserPaths(queryFn)`
   Test doubles: injected `queryFn` throwing error, cleared `process.env`
   Expected RED: current `resolveUserPaths` does not return `usedFallback: true`.
4. Run test — verify FAIL: `node --test tests/resolve-temp.test.js`
5. Write failing test for: Docker remap preserves displayPath
   Test file: `tests/scan-roots.test.js`
   Level: integration
   Test intent: Given `SCAN_HOST_MOUNT='{"c":"/mnt/c"}'` and `HOST_USER=jane`, When `getWhitelist` builds the `Local\Temp` entry, Then `path` is `/mnt/c/Users/jane/AppData/Local/Temp` and `displayPath` is `C:\Users\jane\AppData\Local\Temp`.
   Exercise through: exported `getWhitelist({ scanHostMount, scanRoots })`
   Test doubles: injected resolution returning `C:\Users\jane\AppData\Local\Temp`
   Expected RED: current `getWhitelist` does not expose `usedFallback` on the entry; adding entry assertion `entry.fallback === false` fails on current code.
6. Run test — verify FAIL: `node --test tests/scan-roots.test.js`
7. Write failing test for: fallback marker on whitelist entry
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given profile resolution used fallback (`usedFallback: true`), When `getWhitelist` builds the `Local\Temp` entry, Then the entry carries a `fallback: true` property.
   Exercise through: exported `getWhitelist` with injected failing resolution
   Test doubles: injected resolution failure
   Expected RED: `getWhitelist` does not emit `fallback: true` on the entry.
8. Run test — verify FAIL: `node --test tests/server.test.js`
9. Implement in `lib/resolve-temp.js`: return `{ localAppData, temp, usedFallback }` (setting `usedFallback: true` when fallback to `C:\Temp` occurs) and update `server.js` (`getWhitelist` propagates `fallback: true` to the `Local\Temp` entry when `usedFallback` is true). Preserve Docker `applyHostMount` and `displayPath` behavior.
10. Refactor while green; commit: `fix(server): robust profile resolution with fallback marker`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 2 + Story 1 fallback-exemption scenario

## WHY THIS APPROACH
Complexity: standard
Justification: Two files, one new contract field consumed by the UI, needs care not to break Docker remap.

## SANDWICH CONTEXT
[CRITICAL: Zero new dependencies; Docker `SCAN_HOST_MOUNT` remap must keep working]
You are hardening Windows profile resolution and adding a fallback marker.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — robust resolution + fallback exemption.
Files in scope: `lib/resolve-temp.js`, `server.js` (`getWhitelist`, `makeEntry`), `tests/resolve-temp.test.js`, `tests/scan-roots.test.js`, `tests/server.test.js`
Available after: none (prereq)
Architecture rule: preserve `applyHostMount`/`toContainerPath` behavior and `displayPath` output.
[RESTATE: fallback entries must be identifiable so the UI can keep them visible]

## DELIVERABLE
Given registry path with a space, When resolving, Then the exact path (space preserved) is used.
Given all resolution sources fail, Then `temp = C:\Temp` and `usedFallback = true`.
Given `SCAN_HOST_MOUNT` and `HOST_USER`, When resolving, Then container `path` is remapped and `displayPath` stays the Windows path.
Given fallback was used, When `getWhitelist` runs, Then the `Local\Temp` entry has `fallback: true`.
Given normal resolution, Then entry has no `fallback` field (or `false`).

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - Space/domain/fallback shapes covered
  - Docker remap regression tests stay green (`tests/scan-roots.test.js`)
  - Conventional commit
Must-not-have:
  - Breaking existing `getWhitelist` entry shape for non-fallback entries
  - Touching cleanup registry
Open question risks:
  - `fallback` field name/contract → if UI task disagrees, report NEEDS_CONTEXT
Rollback note:
  - Remove `fallback` field and revert `resolve-temp.js`; no behavior loss beyond the UI exemption.
Red flags:
  - Docker remap test breaks → STOP
  - Out-of-scope files touched → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: resolution + marker scenarios pass; existing scan-roots tests green
Uncertain when: marker contract disputed
Escalate when: Docker remap regresses

---

### Task 4: SSE scan streaming endpoint [depends: T2] [test-risk]

## OBJECTIVE
Add a `GET /api/scan/stream` Server-Sent Events endpoint that emits per-folder progress and a terminal done event, with clean disconnect handling.

Steps:
1. Write failing test for: SSE stream contract
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given the server is started with a fixture whitelist, When a client requests `GET /api/scan/stream`, Then the response has `content-type: text/event-stream`, emits at least one `event: folder` frame whose `data` is a JSON entry, and ends with an `event: done` frame carrying the full `{ entries, scannedAt, partial }` payload.
   Exercise through: the HTTP route (real server on 127.0.0.1)
   Test doubles: fixture whitelist roots (filesystem is real, small)
   Expected RED: route does not exist → 404.
2. Run test — verify FAIL: `node --test tests/server.test.js`
3. Write failing test for: disconnect cleanup
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given a client aborts the SSE request mid-stream, When the connection closes, Then the server stops work for that stream and does not throw or leak a listener.
   Exercise through: HTTP route + socket abort
   Test doubles: none
   Expected RED: no route/no cleanup path.
4. Run test — verify FAIL: `node --test tests/server.test.js`
5. Implement the route in `server.js`: set SSE headers (reuse `securityHeaders()`), stream `event: folder` per completed folder via the existing `onProgress`/`scanAll` loop, send `event: done`, and register `req.on('close')` to abort. Do not break the existing `GET /api/scan`.
6. Refactor while green; commit: `feat(server): add SSE scan streaming endpoint`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 3 "Progress streaming" rule

## WHY THIS APPROACH
Complexity: standard
Justification: New HTTP route with a streaming contract; test level is integration (HTTP boundary) — hence `[test-risk]`.

## SANDWICH CONTEXT
[CRITICAL: `GET /api/scan` must keep working unchanged as the fallback]
You are adding an SSE streaming route to `server.js`.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — SSE with polling fallback.
Files in scope: `server.js`, `tests/server.test.js`
Available after: T2 (walker emits progress)
Architecture rule: no new dependencies; plain `node:http` response streaming; keep CSP/security headers.
[RESTATE: access_denied/partial entries in the stream must keep their status and reason]

## DELIVERABLE
Given a client connects to `/api/scan/stream`, When scan progresses, Then `event: folder` frames stream per folder and `event: done` terminates the payload.
Given the client disconnects, When the socket closes, Then the server aborts that stream without error.
[must-not] Given the SSE route exists, When a client calls `GET /api/scan`, Then the existing JSON response must NOT change.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - `text/event-stream` headers + security headers preserved
  - Disconnect cleanup
  - Conventional commit
Must-not-have:
  - Removing or altering `GET /api/scan`
  - WebSockets or external deps
Open question risks:
  - Event frame shape consumed by T7 → keep the documented shape; if changed, report NEEDS_CONTEXT
Rollback note:
  - Remove the route; client (T7) falls back to `GET /api/scan`.
Red flags:
  - Existing `/api/scan` test breaks → STOP

## STOP CONDITIONS
Done when: stream contract + disconnect scenarios pass; existing scan tests green
Uncertain when: frame shape disputed
Escalate when: fallback endpoint regresses

---

### Task 5: UI hide not_found with reveal chip and empty state [prereq]

## OBJECTIVE
Hide `not_found` entries by default in the results render, add a reveal chip, and show an empty state when all entries are `not_found` — never hiding `access_denied`/`partial`.

Steps:
1. Write failing test for: not_found hidden by default + chip
   Test file: `tests/public.test.js`
   Level: integration (vm harness rendering `public/app.js`)
   Test intent: Given a scan payload of 18 entries including 4 with status `not_found`, When results render with default preferences, Then 14 entries are visible in the grouped list, a chip reading "4 folder disembunyikan (tidak ditemukan)" is shown, and no `not_found` badge appears in the visible list.
   Exercise through: `loadApp`/render entrypoint used by existing public tests
   Test doubles: existing fake DOM + fetch harness
   Expected RED: current render shows all 18 entries (no `hideNotFound` filter exists).
2. Run test — verify FAIL: `node --test tests/public.test.js`
3. Write failing test for: chip click reveals hidden not_found
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given the chip "4 folder disembunyikan (tidak ditemukan)" is visible, When the user clicks the chip, Then all 18 entries are visible, the 4 entries show status badge "Tidak ditemukan", and the chip disappears.
   Exercise through: same render entrypoint
   Test doubles: existing fake DOM
   Expected RED: clicking current chip toggles `prefs.hideZero`, not the new `prefs.hideNotFound` filter.
4. Run test — verify FAIL: `node --test tests/public.test.js`
5. Write failing test for: access_denied and partial are never hidden
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given 2 `not_found`, 1 `access_denied`, 1 `partial` entries, When results render with default filter, Then only the 2 `not_found` are hidden and the `access_denied` and `partial` entries remain visible with their reason badges.
   Exercise through: same render entrypoint
   Test doubles: existing fake DOM
   Expected RED: no status filter logic exists; all 4 entries render as cards.
6. Run test — verify FAIL: `node --test tests/public.test.js`
7. Write failing test for: empty state when all entries are not_found
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given `hideNotFound` is true and all scanned folders return `not_found`, When results render, Then an empty state message is displayed alongside the reveal chip (chip shows total count).
   Exercise through: same render entrypoint
   Test doubles: existing fake DOM
   Expected RED: current code renders generic "Belum ada data untuk ditampilkan" when `rendered === 0` instead of pairing the empty state container with the reveal chip.
8. Run test — verify FAIL: `node --test tests/public.test.js`
9. Implement in `public/app.js`: add `hideNotFound` preference (default true, persisted in localStorage), filter `status === 'not_found'` in `renderScan`, render the reveal chip for `not_found` count, and handle the all-not_found empty state. Preserve existing `hideZero` behavior.
10. Refactor while green; commit: `feat(web): hide not_found folders behind reveal chip`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 1 rules 1.1–1.3

## WHY THIS APPROACH
Complexity: standard
Justification: Render + prefs + accessibility text in one UI module; must not regress existing hide-zero/prefs tests.

## SANDWICH CONTEXT
[CRITICAL: `access_denied` and `partial` entries must NEVER be hidden by any filter]
You are adding the missing-folder filter to the UI.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — hide `not_found` with reveal chip.
Files in scope: `public/app.js`, `tests/public.test.js`
Available after: none (prereq)
Architecture rule: follow existing prefs/localStorage + `createEl` render patterns; vanilla JS only.
[RESTATE: only `not_found` is filterable; `access_denied`/`partial` stay visible]

## DELIVERABLE
Given 4 `not_found` of 18, When rendered, Then 14 visible + chip "4 folder disembunyikan (tidak ditemukan)".
Given the chip is clicked, Then all entries are visible.
Given `access_denied`/`partial`, Then they are always visible.
Given all entries `not_found`, Then an empty state renders with the chip.
[must-not] Given `partial` or `access_denied`, When the filter is on, Then the entry must NOT be hidden.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - Chip has accessible label (aria)
  - Existing hide-zero + prefs tests stay green
  - Conventional commit
Must-not-have:
  - Hiding `access_denied`/`partial`
  - Changing scan-fetch/race (`requestId`) logic
Open question risks:
  - Whether the chip also appears when count is 0 → assumed hidden when 0
Rollback note:
  - Remove the filter; all entries render as before.
Red flags:
  - access_denied/partial hidden → STOP
  - Existing prefs test breaks → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: filter/chip/empty-state scenarios pass; existing public tests green
Uncertain when: chip visibility rules disputed
Escalate when: never-hide invariant violated

---

### Task 6: UI fallback exemption badge [depends: T3, T5]

## OBJECTIVE
Keep fallback entries (profile resolution failed) visible even when `hideNotFound` is on, with a warning badge.

Steps:
1. Write failing test for: fallback entry stays visible with warning
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given an entry with `fallback: true` and status `not_found`, When results render with `hideNotFound` on, Then that entry is visible with a warning badge ("Fallback — resolusi profil gagal") and is omitted from the hidden count.
   Exercise through: render entrypoint
   Test doubles: existing fake DOM + fetch harness
   Expected RED: T5's `status === 'not_found'` filter hides all `not_found` entries including `fallback: true` entries.
2. Run test — verify FAIL: `node --test tests/public.test.js`
3. Write failing test for: hidden count excludes fallback entries
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given 3 `not_found` entries where 1 has `fallback: true`, When results render with filter on, Then the chip reads "2 folder disembunyikan (tidak ditemukan)".
   Exercise through: render entrypoint
   Test doubles: existing fake DOM
   Expected RED: T5's chip count includes all `not_found` entries regardless of `fallback`.
4. Run test — verify FAIL: `node --test tests/public.test.js`
5. Implement in `public/app.js`: exempt `entry.fallback === true` from the `not_found` filter, render a warning badge on fallback cards, and exclude fallback entries from the hidden count calculation.
6. Run test — verify PASS: `node --test tests/public.test.js`
7. Refactor while green; commit: `feat(web): keep fallback entries visible with warning badge`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 1 "Fallback missing path is exempt from hiding"

## WHY THIS APPROACH
Complexity: lightweight
Justification: One conditional branch + badge in an existing render path.

## SANDWICH CONTEXT
[CRITICAL: only `not_found` non-fallback entries are hidden]
You are adding the fallback exemption to the results render.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — fallback exemption.
Files in scope: `public/app.js`, `tests/public.test.js`
Available after: T3 (`fallback` marker), T5 (filter exists)
Architecture rule: consume the `fallback` field from the scan payload; vanilla JS only.
[RESTATE: fallback entries remain visible with a warning badge]

## DELIVERABLE
Given `fallback: true` + `not_found`, When rendered with the filter on, Then the entry is visible with a warning badge.
Given fallback entries exist, Then the hidden count excludes them.
[must-not] Given a non-fallback `not_found`, When rendered, Then it must still be hidden.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - Warning badge accessible label
  - Conventional commit
Must-not-have:
  - Exempting non-fallback entries
Open question risks:
  - Badge copy wording → assumed "Fallback — resolusi profil gagal"
Rollback note:
  - Remove the exemption; fallback entries hide like other `not_found`.
Red flags:
  - Non-fallback entries exempted → STOP

## STOP CONDITIONS
Done when: fallback exemption scenario passes; T5 tests still green
Uncertain when: badge copy disputed
Escalate when: filter invariant broken

---

### Task 7: UI SSE client with GET /api/scan fallback [depends: T4, T5] [test-risk]

## OBJECTIVE
Consume `/api/scan/stream` via EventSource to render incremental progress, and fall back to `GET /api/scan` when EventSource is unavailable or errors.

Steps:
1. Write failing test for: incremental render from SSE
   Test file: `tests/public.test.js`
   Level: integration (vm harness with injected EventSource mock)
   Test intent: Given an injected EventSource that emits two `folder` events then a `done` event, When scan starts, Then cards render incrementally for each folder event and the final `done` payload drives the completed render.
   Exercise through: scan trigger entrypoint
   Test doubles: injected `EventSource` mock; do NOT mock the render/state under test
   Expected RED: `app.js` uses only `fetch('/api/scan')` today.
2. Run test — verify FAIL: `node --test tests/public.test.js`
3. Write failing test for: fallback to GET /api/scan
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given `EventSource` is undefined or emits an `error`, When scan runs, Then the client issues `GET /api/scan` and renders the JSON result; the existing `requestId` race-safety behavior is preserved.
   Exercise through: scan trigger entrypoint
   Test doubles: absent/broken EventSource mock + fetch mock
   Expected RED: no fallback path exists.
4. Run test — verify FAIL: `node --test tests/public.test.js`
5. Implement in `public/app.js`: prefer EventSource to `/api/scan/stream`, parse `folder` frames into incremental state, finalize on `done`, and fall back to the existing `fetch('/api/scan')` path on unavailability/error. Preserve `state.nextRequestId` race-safety and loading state.
6. Refactor while green; commit: `feat(web): stream scan progress with fetch fallback`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 3 "Progress streaming" rule; Story 1 (rendered results reuse T5 filter)

## WHY THIS APPROACH
Complexity: standard
Justification: New client transport + fallback with race-safety preservation; test level crosses HTTP + DOM (hence `[test-risk]`).

## SANDWICH CONTEXT
[CRITICAL: `GET /api/scan` fallback must always work if streaming fails]
You are adding the SSE client transport to the UI.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — SSE with polling/fetch fallback.
Files in scope: `public/app.js`, `tests/public.test.js`
Available after: T4 (endpoint), T5 (filter/render)
Architecture rule: vanilla JS; no dependencies; preserve `requestId` dedup + loading state.
[RESTATE: if EventSource fails, the app must still complete a scan via GET /api/scan]

## DELIVERABLE
Given SSE `folder` events, When received, Then cards render incrementally.
Given SSE `done`, Then the full result renders.
Given EventSource unavailable/errors, Then `GET /api/scan` is used and the result renders.
[must-not] Given an SSE failure, When falling back, Then the app must NOT leave the UI in a permanent loading state.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - Race-safety (`requestId`) preserved
  - Loading state cleared on both success and fallback
  - Conventional commit
Must-not-have:
  - Dropping the fetch fallback
  - Breaking existing scenario 1–3 public tests
Open question risks:
  - SSE frame shape from T4 → if it differs, report NEEDS_CONTEXT
Rollback note:
  - Remove EventSource usage; revert to `fetch('/api/scan')`.
Red flags:
  - Fallback removed or loading stuck → STOP

## STOP CONDITIONS
Done when: incremental + fallback scenarios pass; existing scan/race tests green
Uncertain when: frame shape mismatches T4
Escalate when: loading state can deadlock

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Bounded concurrency helper | prereq | lightweight | max in-flight ≤ limit, order preserved |
| T2 | walkFolder concurrency + dirent + deadline | T1 | standard | counts identical; lstat only for files; deadline guard |
| T3 | Profile resolution + fallback marker | prereq | standard | space/fallback/docker shapes; `usedFallback` & `fallback:true` marker |
| T4 | SSE scan streaming endpoint | T2 | standard | `text/event-stream` frames + `done`; disconnect cleanup |
| T5 | UI hide not_found + chip + empty state | prereq | standard | 14/18 visible + chip; access_denied/partial always shown |
| T6 | UI fallback exemption badge | T3, T5 | lightweight | fallback entry visible with badge; hidden count excludes it |
| T7 | UI SSE client + fetch fallback | T4, T5 | standard | incremental render; fallback to GET /api/scan |
