# Task T2 — walkFolder bounded concurrency, dirent reuse, strict deadline regression

**Phase:** 2
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
   Test intent (approved safety exception): Given typed directory entries, When `walkFolder` runs, Then it uses dirents for type discovery but may `lstat` each typed directory solely to reject symlink/generic Windows reparse points before traversal; file `lstat` is still used for size and safety. The original files-only `lstat` count is superseded by this user-approved safety policy.
   Exercise through: exported `walkFolder(rootPath, context)`
   Test doubles: injected `context.fs` that counts `lstat` calls per path
   Expected RED: sequential walker lacks bounded in-flight calls and typed-directory reparse protections; safety test must fail if the typed reparse directory is traversed.
4. Run test — verify FAIL: `node --test tests/server.test.js`
5. Write failing test for: strict deadline prompt return
   Test file: `tests/server.test.js`
   Level: unit (walkFolder directly)
   Test intent: Given `context.startedAt` already ≥ `context.timeoutMs` before `walkFolder` is called, When `walkFolder` runs, Then it returns immediately with `{ fileCount:0, sizeBytes:0, skipped:0, timedOut:true, partial:true }` without issuing any filesystem readdir or lstat call.
   Exercise through: exported `walkFolder(rootPath, context)`
   Test doubles: injected `context.now()` returning `startedAt + timeoutMs`, injected `fs` throwing if `readdir` is invoked
   Expected RED: current `walkFolder` enters the while loop and executes `readdir` before the loop-body `hasTimedOut` check → throws error from fs stub instead of returning immediately.
6. Run test — verify FAIL: `node --test tests/server.test.js`
7. Implement in `server.js`: check `hasTimedOut` before filesystem operations and inside the loop; use `mapLimit` from `lib/concurrency.js` for the per-directory entry loop; reuse dirent type while retaining a typed-directory `lstat` solely for symlink/reparse safety (and file `lstat` for size/safety). Reject symlink/reparse configured roots. Race root `lstat`, directory `readdir` and entry work against the shared global deadline so an unsettled filesystem promise cannot prevent prompt `partial` return; do not launch new filesystem work after expiry. Preserve `skipped` accounting and the `skipRatio > 0.10 → partial` rule exactly.
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
[RESTATE: never hide or reclassify `access_denied`/`partial`; strict deadline returns promptly even when FS promises hang; typed-directory lstat is permitted only for reparse safety]

## DELIVERABLE
Given a fixture tree, When `walkFolder` runs concurrently, Then counts/size/skipped/partial match the sequential baseline.
Given in-flight lstat instrumentation, When `walkFolder` runs, Then max concurrent lstat ≤ configured limit.
Given `dirent` type info available, When `walkFolder` walks, Then typed-directory `lstat` is permitted solely for symlink/reparse safety before descent, never only for type determination. File `lstat` remains for size/safety.
Given the global deadline has already elapsed before `walkFolder` is called, When `walkFolder` runs, Then it returns immediately with `timedOut=true, partial=true` and zero fs calls.
[must-not] Given a skip ratio > 0.10, When walking, Then the folder must NOT be reported `ready`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - Identical `{fileCount,sizeBytes,skipped,timedOut,partial}` vs baseline
  - Bounded in-flight lstat (limit honored)
  - Dirent types avoid type-only `lstat`; typed-directory `lstat` is permitted solely for symlink/reparse safety
  - Conventional commit
Must-not-have:
  - Changes to `lib/cleanup-engine.js` or `lib/cleanup-targets.js`
  - Flaky wall-clock timing thresholds in CI (allow a short actual timer only to prove prompt return when an FS promise never settles; assert outcome, not a precise elapsed threshold)
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
