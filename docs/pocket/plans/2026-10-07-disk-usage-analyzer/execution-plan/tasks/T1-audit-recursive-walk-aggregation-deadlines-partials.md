# Task T1 — Audit recursive walk, aggregation, deadlines, partials

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 1: Audit recursive walk, aggregation, deadlines, partials [prereq]

## OBJECTIVE
Verify `lib/analyzer.js` against Story 1 GWTs (7 scenarios) using existing tests, and add characterization tests for behaviors that exist but are not yet covered.

Steps:
1. Run existing analyzer unit tests to confirm baseline:
   `node --test tests/analyzer.test.js`
2. Audit existing tests against spec Story 1 GWTs (7 total):
   - "Complete aggregate" → covered by `walkDir aggregates recursively and classifies display paths`
   - "Empty root" → covered by `walkDir aggregates recursively`
   - "Link safety (symlink/reparse point skipped)" → covered by `symlinks are skipped, never followed`
   - "Permission failure (EACCES/EPERM skipped)" → NOT YET TESTED (behavior exists in `lib/analyzer.js` lines 139–141, 191). See step 3.
   - "Deadline" → covered by `analyze times out and marks the root partial`
   - "Cancellation" → covered by `analyze is cancelled via AbortSignal and marks partial`
   - "Unavailable root" → covered by `createRoots()` returning configured entries; audit ENOENT scan handling in `tests/disk-analyzer.test.js`
   Plus 2 architecture-constraint behaviors: "Hung root lstat" (covered by `progressive: hung root lstat still produces a partial tree`) and "Child lstat loser" (covered by parent partial-flag logic).
3. Add a **characterization test** (not a TDD RED cycle) for EACCES/EPERM child handling in `tests/analyzer.test.js`: `analyze` with a mocked fs whose `readdir`/`lstat` throws `EACCES`; assert the entry is skipped and the scan completes with `reason: 'access_denied'`. This test is expected to PASS immediately because the behavior already exists at baseline — it documents current behavior, it does not drive new implementation.
4. Run analyzer tests:
   `node --test tests/analyzer.test.js`
5. If the characterization test fails, that reveals a baseline defect — report `DONE_WITH_CONCERNS` and do not silently alter production behavior.
6. Commit: `test(analyzer): characterize permission-error handling and audit Story 1 GWT coverage`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rule: Recursive read-only analysis

## WHY THIS APPROACH
Complexity: standard
Justification: Core analyzer behavior is already implemented; task audits 7 Story 1 GWTs plus 2 architecture-constraint behaviors and characterizes one uncovered path.

## SANDWICH CONTEXT
[CRITICAL: Retrospective mode; zero dependencies; every fs call races single shared deadline promise; symlinks skipped; partial aggregates are lower bounds.]
You are auditing core analyzer verification.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: Retrospective verification of committed modular monolith.
Files in scope: lib/analyzer.js, tests/analyzer.test.js, tests/disk-analyzer.test.js
Available after: none (prereq)
Architecture rule: No filesystem mutation, no shell execution, no client paths on wire.
[RESTATE: Retrospective mode; zero dependencies; every fs call races single shared deadline promise; symlinks skipped; partial aggregates are lower bounds.]

## DELIVERABLE
Given a normal nested tree, When scan completes, Then recursive size/file/folder totals match the files discovered.
Given a symlink/reparse point or access-denied child (EACCES/EPERM), When scanning, Then it is skipped and the scan continues.
Given a held filesystem operation, When abort or global timeout wins, Then scan returns promptly with partial state.
Given a hung root lstat, When deadline fires, Then an empty partial tree is returned.
Given a configured root path that does not exist, When roots are enumerated, Then it remains listed from config; when scanned, it returns not_found.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - All 7 Story 1 GWTs mapped to a verifying test
  - Existing tests in `tests/analyzer.test.js` pass (12 currently; 13 after the characterization test)

Must-not-have:
  - Fabricated RED steps for already-passing tests
  - Any new feature beyond baseline 086dfc9

Open question risks:
  - Spec is retrospective; baseline 086dfc9 is canonical

Rollback note:
  - Process restart discards in-memory sessions; no persistent state

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Must-not behavior implemented → STOP

## STOP CONDITIONS
Done when: All Story 1 GWT scenarios verified and passing
Uncertain when: baseline behavior differs from spec GWT
Escalate when: constraint violated
