# EXECUTION PLAN — Disk Usage Analyzer (retrospective verification)

**Date:** 2026-10-07  
**Spec:** docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md  
**Status:** draft  
**Total tasks:** 8

---

## Execution Overview

### Recommended Order
```
T1 → T2, T3, T4 (parallel) → T5 → T6, T7 (parallel) → T8
```

> Dependency order above is **recommended** — pocket skill enforces actual parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T2, T3, T4 | T1 completes |
| Group B | T6, T7 | T5 completes |

### Constraints Reminder
**Architecture:** Zero runtime dependencies (Node built-ins + vanilla JS); all filesystem calls race a single abort/deadline promise; opaque server-issued node IDs only; Windows display-path mapping via `SCAN_HOST_MOUNT` before classification; no mutation endpoints; CSP + security headers on all responses; Docker host binds read-only, container runs non-root with read-only rootfs.  
**Out-of-scope:** Any mutating endpoint (DELETE/PUT/PATCH), file deletion/execution, pagination, SSE replay, rate limiting, authentication, HTTPS, editable roots UI, background daemon, new classifier rules or guides, any feature not present at baseline `086dfc9`.  
**Retrospective mode:** Implementation and primary tests are already committed at `086dfc9`. Tasks audit existing tests against spec GWTs, run verification commands, and add new failing-first tests ONLY for identified coverage gaps. Task 8 performs independent review; plan closing is deferred to `pocket-closing`.

### File Structure Map
```
Rule: Recursive read-only analysis
  Test:   tests/analyzer.test.js        (verifies T1)
  Test:   tests/concurrency.test.js     (verifies T2)
  Test:   tests/disk-analyzer.test.js   (verifies T1 + T5 HTTP)
Rule: Progressive and explorable results
  Test:   tests/analyzer.test.js        (T1 progressive GWTs)
  Test:   tests/disk-analyzer.test.js   (T5 SSE + live tree)
  Test:   tests/ui-regression.test.js   (T6 live refresh/expansion)
Rule: Path classification and manual guidance
  Test:   tests/analyzer.test.js        (T4 classification GWTs)
Rule: Safety and deployment
  Test:   tests/read-only.test.js       (T7 runtime/Docker audit)
  Test:   tests/disk-analyzer.test.js   (T5 cross-origin mutation rejection)
```

---

## Pocket Packets

---

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

---

### Task 2: Audit concurrency helper mapLimit [depends: T1]

## OBJECTIVE
Verify `lib/concurrency.js` against concurrency GWT scenarios using existing unit tests in `tests/concurrency.test.js`.

Steps:
1. Audit existing `tests/concurrency.test.js` tests against spec GWTs:
   - "Limits in-flight calls and preserves order" → covered
   - "Resolves [] for empty array" → covered
   - "Runs every item when limit exceeds count" → covered
   - "Rejects returned promise and leaks no unhandled rejection" → covered
2. Run concurrency tests:
   `node --test tests/concurrency.test.js`
3. Verify all 5 tests pass.
4. Commit verification status: `test(concurrency): audit mapLimit helper GWT scenarios against baseline`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rule: Recursive read-only analysis

## WHY THIS APPROACH
Complexity: lightweight
Justification: Single-purpose helper with 5 existing unit tests; verification-only.

## SANDWICH CONTEXT
[CRITICAL: mapLimit must bound concurrency, preserve order, and leak no rejections.]
You are auditing the concurrency helper tests.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: Single shared deadline + bounded concurrency per directory.
Files in scope: lib/concurrency.js, tests/concurrency.test.js
Available after: T1
Architecture rule: Zero dependencies; mapLimit is the only parallelism primitive.
[RESTATE: mapLimit must bound concurrency, preserve order, and leak no rejections.]

## DELIVERABLE
Given 20 items and limit 4, When mapLimit runs, Then at most 4 workers execute concurrently and results preserve input order.
Given an empty array, When mapLimit runs, Then it resolves [].
Given a rejecting mapper, When mapLimit runs, Then promise rejects without leaking.

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - All 5 concurrency tests pass

## STOP CONDITIONS
Done when: DELIVERABLE verified and tests pass
Escalate when: constraint violated

---

### Task 3: Audit opaque node registry [depends: T1]

## OBJECTIVE
Verify `lib/tree-registry.js` against opaque ID GWT scenarios using existing tests.

Steps:
1. Audit existing test in `tests/analyzer.test.js`:
   - "node registry issues stable opaque ids resolved by id only" → covers 16-char SHA-1 hex issuance and lookup.
2. Verify the opaque-lookup API contract in `server.js` lines 471–493: tree endpoints resolve `nodeIdParam` via `session.registry.get(id)` and never accept a client-supplied filesystem path. No additional unit test is needed — the existing HTTP test `HTTP API progressive scan and cancellation` in `tests/disk-analyzer.test.js` exercises this by fetching `/api/scans/:id/tree/root` and `/api/scans/:id/tree/:nodeId` with server-issued IDs only.
3. Run test:
   `node --test tests/analyzer.test.js --test-name-pattern="node registry"`
4. Verify test passes.
5. Commit verification status: `test(registry): audit opaque node registry GWT scenarios against baseline`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rule: Recursive read-only analysis (opaque IDs)

## WHY THIS APPROACH
Complexity: lightweight
Justification: Registry is small and self-contained; verified via existing test.

## SANDWICH CONTEXT
[CRITICAL: Client never receives filesystem paths; only server-issued opaque IDs (16-char SHA-1 hex).]
You are auditing the node registry tests.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: Opaque server-issued IDs prevent path traversal.
Files in scope: lib/tree-registry.js, tests/analyzer.test.js
Available after: T1
Architecture rule: No client-supplied paths accepted as node selectors.
[RESTATE: Client never receives filesystem paths; only server-issued opaque IDs (16-char SHA-1 hex).]

## DELIVERABLE
Given same path, When nodeId called, Then returns stable 16-char SHA-1 hex.
Given registered node, When registry.get(id) called, Then returns node.

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - Registry test passes

## STOP CONDITIONS
Done when: DELIVERABLE verified
Escalate when: constraint violated

---

### Task 4: Audit classification rules and guides [depends: T1]

## OBJECTIVE
Verify `lib/classifier.js` and `lib/cleanup-guides.js` against classification and guide GWT scenarios.

Steps:
1. Audit existing tests:
   - "analyze maps real mount paths onto Windows display paths" → covers mapped display path classification
   - "classify unknown path" → test `classify('C:\\Unknown\\Path')` in `tests/analyzer.test.js`
2. Run classification tests:
   `node --test tests/analyzer.test.js --test-name-pattern="classify\|maps real mount"`
3. Verify all 11 guides in `lib/cleanup-guides.js` exist with required fields (id, title, description, commands array).
4. Commit verification status: `test(classifier): audit classification rules and guides against baseline`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rule: Path classification and manual guidance

## WHY THIS APPROACH
Complexity: lightweight
Justification: Classification rules and guides are static data; verified via existing tests.

## SANDWICH CONTEXT
[CRITICAL: Classification runs on Windows display paths only; unknown paths default to unknown; 11 guides are text-only, never executed.]
You are auditing classification and guide verification.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: 15 exact-path rules, 11 text-only guides.
Files in scope: lib/classifier.js, lib/cleanup-guides.js, tests/analyzer.test.js
Available after: T1
Architecture rule: No guessed recommendations for unknown paths; no command execution.
[RESTATE: Classification runs on Windows display paths only; unknown paths default to unknown; 11 guides are text-only, never executed.]

## DELIVERABLE
Given mapped Windows display path, When classified, Then configured risk/category/guide metadata returned.
Given unmatched path, When classified, Then risk/category are unknown.
Given guides module, When enumerated, Then 11 text-only guides exist.

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - Classification tests pass; 11 guides confirmed

Must-not-have:
  - New classifier rules or guides not present at baseline

## STOP CONDITIONS
Done when: DELIVERABLE verified
Escalate when: constraint violated

---

### Task 5: Audit HTTP/SSE API contracts and read-only routes [depends: T1]

## OBJECTIVE
Verify `server.js` against HTTP/SSE GWT scenarios using `tests/disk-analyzer.test.js`.

Steps:
1. Audit `tests/disk-analyzer.test.js` test `HTTP API progressive scan and cancellation`:
   - Gated readdir blocks on `slow/`
   - `POST /api/scans` returns 202 scanId
   - `GET /api/scans/:id/tree/root` while scanning returns status 'scanning', partial true, fast.txt child, live totals (100 B, 1 file)
   - `POST /api/scans/:id/cancel` returns 202 cancelling
   - `GET /api/scans/:id/status` returns cancelled after release
2. Verify live treemap endpoint returns 200 with partial data during scan (not 409).
3. Add a characterization integration test in `tests/disk-analyzer.test.js` for configured missing roots: `/api/roots` lists configured root regardless of existence; starting a scan on it returns a session and terminal status/error `not_found`. The configured root remains visible; no preflight filesystem check is expected.
4. Add a characterization integration test in `tests/disk-analyzer.test.js` for cross-origin state-changing request rejection: send `Origin` that differs from request host to `POST /api/scans`; assert 403. Expected PASS: server already implements same-origin validation in `validSameOrigin()` (server.js line 277) and returns 403 for disallowed origins. This test documents existing behavior, not a new requirement.
5. Run HTTP tests:
   `node --test tests/disk-analyzer.test.js`
6. Verify characterization and cross-origin tests pass; if behavior contradicts baseline/spec, report a concern without changing server behavior absent explicit scope approval.
7. Commit verification status: `test(server): audit API contracts, missing roots, and cross-origin rejection`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rules: Progressive and explorable results; Safety and deployment

## WHY THIS APPROACH
Complexity: standard
Justification: HTTP/SSE integration test verifies progressive scanning, cancellation, and live partial tree data.

## SANDWICH CONTEXT
[CRITICAL: No PUT/PATCH/DELETE; POST only at scan/cancel; same-origin on mutations; localhost-only bind; opaque node IDs on wire; security headers on every response.]
You are auditing HTTP/SSE server verification.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: SSE for progress; live partial treemap during scanning; opaque IDs; strict read-only API.
Files in scope: server.js, tests/disk-analyzer.test.js
Available after: T1
Architecture rule: No mutation endpoints, no shell execution, no client paths on wire.
[RESTATE: No PUT/PATCH/DELETE; POST only at scan/cancel; same-origin on mutations; localhost-only bind; opaque node IDs on wire; security headers on every response.]

## DELIVERABLE
Given fast.txt and gated slow/, When scanning, Then live tree returns fast.txt + live totals with status 'scanning' and partial true.
Given running scan, When cancel posted, Then status reaches cancelled without waiting on held read.
Given running scan, When treemap requested, Then returns 200 with partial data (not 409).
Given a cross-origin POST to a state-changing endpoint, When validated, Then server rejects it with 403.

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - `tests/disk-analyzer.test.js` passes

Must-not-have:
  - Mutating routes, shell execution, client paths on wire

## STOP CONDITIONS
Done when: DELIVERABLE verified and HTTP test passes
Escalate when: constraint violated

---

### Task 6: Audit frontend UI behaviors [depends: T5]

## OBJECTIVE
Verify `public/app.js` and `public/index.html` against UI GWT scenarios using `tests/ui-regression.test.js`.

Steps:
1. Audit existing tests in `tests/ui-regression.test.js` (7 tests via `node:vm` DOM stub):
   - `sortRows orders by size desc by default`
   - `sortRows supports all sort modes`
   - `renderTree produces expand indicator and guidance link`
   - `renderTree expands/collapses children via state.expanded`
   - `renderGuide renders copy buttons and commands`
   - `matchesFilter filters by path and min size`
   - `live refresh preserves expanded nodes and updates children`
2. Verify CSS in `public/index.html`: `.guide-link` uses `var(--brand)` for border/color and hover inverts.
3. Verify the copy-only GWT in `public/app.js` lines 583–592: click handlers on `.copy-btn` call `navigator.clipboard.writeText(command)` and show a toast; no process is spawned. The existing test `frontend: renderGuide renders copy buttons and commands` covers DOM rendering; the handler logic is static and auditable.
4. Run UI regression tests:
   `node --test tests/ui-regression.test.js`
5. Verify all 7 tests pass.
6. Commit verification status: `test(ui): audit frontend UI behaviors against baseline`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rules: Progressive and explorable results; Path classification and manual guidance

## WHY THIS APPROACH
Complexity: standard
Justification: 7 UI regression tests cover sort/filter, tree expansion, live refresh, guide rendering, and brand styling using zero-dependency `node:vm` stub.

## SANDWICH CONTEXT
[CRITICAL: UI uses server-issued opaque IDs; no client paths on wire; zero frontend dependencies; Indonesian blue/purple theme uses --brand: #2563eb / --brand-2: #7c3aed.]
You are auditing frontend UI verification.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: WinDirStat-style tree + treemap + guides, vanilla JS, no build step.
Files in scope: public/app.js, public/index.html, tests/ui-regression.test.js
Available after: T5
Architecture rule: Zero frontend dependencies; all navigation via opaque IDs.
[RESTATE: UI uses server-issued opaque IDs; no client paths on wire; zero frontend dependencies; Indonesian blue/purple theme uses --brand: #2563eb / --brand-2: #7c3aed.]

## DELIVERABLE
Given sort/filter controls, When applied, Then displayed rows follow selected mode.
Given expanded node set, When live refresh runs, Then expanded set is preserved.
Given guide-link button, When rendered, Then styled with var(--brand).

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - All 7 tests in `tests/ui-regression.test.js` pass

Must-not-have:
  - jsdom or DOM dependencies
  - Client paths on wire

## STOP CONDITIONS
Done when: DELIVERABLE verified and UI tests pass
Escalate when: constraint violated

---

### Task 7: Audit read-only/Docker/security posture [depends: T5]

## OBJECTIVE
Verify runtime, Docker, and security configurations enforce read-only invariants using `tests/read-only.test.js`.

Steps:
1. Audit existing tests in `tests/read-only.test.js` (4 tests):
   - `runtime code never mutates the filesystem or spawns processes`
   - `server exposes no mutating HTTP routes`
   - `docker compose mounts every host path read-only`
   - `dockerfile runs as non-root and never deletes`
2. Verify the Dockerfile rootfs read-only claim: `docker-compose.yml` line 44 sets `read_only: true` on the service, and line 45 mounts `/tmp` as `tmpfs` — the only writable filesystem. The test `dockerfile runs as non-root and never deletes` plus the compose audit together cover the acceptance criterion.
3. Run read-only tests:
   `node --test tests/read-only.test.js`
4. Verify all 4 tests pass.
5. Run full test suite:
   `node --test`
6. Verify 30/30 tests pass across all test files.
7. Commit verification status: `test(security): audit read-only and Docker posture against baseline`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rule: Safety and deployment

## WHY THIS APPROACH
Complexity: standard review
Justification: Static safety audit across runtime files, server routes, Dockerfile, and compose configuration.

## SANDWICH CONTEXT
[CRITICAL: No fs mutation APIs, no shell execution, no mutating routes, Docker host binds read-only, container rootfs read-only, non-root USER, CSP/headers on all responses.]
You are auditing read-only security posture.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: 100% read-only at every layer — runtime, container, API, deployment.
Files in scope: tests/read-only.test.js, Dockerfile, docker-compose.yml, server.js, lib/analyzer.js, lib/classifier.js, lib/cleanup-guides.js, lib/concurrency.js, lib/format.js, lib/tree-registry.js
Available after: T5
Architecture rule: Read-only is an invariant, not a best effort.
[RESTATE: No fs mutation APIs, no shell execution, no mutating routes, Docker host binds read-only, container rootfs read-only, non-root USER, CSP/headers on all responses.]

## DELIVERABLE
Given runtime modules, When audited, Then no forbidden fs mutation or shell spawn calls exist.
Given server.js, When audited, Then no PUT/PATCH/DELETE routes exist.
Given Docker config, When audited, Then host binds are read-only, rootfs is read-only, process is USER node.
Given full suite, When run, Then 30/30 tests pass.

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - All 4 read-only tests pass; full suite 30/30 passes

Must-not-have:
  - Any mutating behavior or writable volume

## STOP CONDITIONS
Done when: DELIVERABLE verified and 30/30 tests pass
Escalate when: constraint violated

---

### Task 8: Independent spec review and plan verification [depends: T2, T3, T4, T5, T6, T7]

## OBJECTIVE
Independent verification that all spec acceptance criteria are covered by passing tests, no scope drift occurred, and full test suite passes. Note: plan close is handled by `pocket-closing` in the closing stage, not by this task.

Steps:
1. Verify spec coverage matrix:
   - Rule 1 (Recursive read-only analysis) → covered by `tests/analyzer.test.js` + `tests/concurrency.test.js`
   - Rule 2 (Progressive and explorable results) → covered by `tests/disk-analyzer.test.js` + `tests/ui-regression.test.js`
   - Rule 3 (Path classification and manual guidance) → covered by `tests/analyzer.test.js`
   - Rule 4 (Safety and deployment) → covered by `tests/read-only.test.js`
2. Verify no out-of-scope behavior was added (no pagination, SSE replay, rate limiting, new guides, auth, HTTPS, background daemon).
3. Run full test suite: `node --test` → expect 30 pass, 0 fail.
4. Run syntax checks: `node --check server.js public/app.js lib/analyzer.js`.
5. Report verification status to session log.

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — all rules

## WHY THIS APPROACH
Complexity: standard review
Justification: Independent audit that retrospective spec matches baseline behavior and full test suite passes.

## SANDWICH CONTEXT
[CRITICAL: Retrospective mode; verification only; plan closing is handled by pocket-closing stage after review.]
You are performing the final independent plan audit.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: Single-process, zero-dependency, opaque IDs, exact-path classification, SSE progressive.
Files in scope: tests/analyzer.test.js, tests/concurrency.test.js, tests/disk-analyzer.test.js, tests/format.test.js, tests/read-only.test.js, tests/ui-regression.test.js
Available after: T2, T3, T4, T6, T7
Architecture rule: Zero dependencies, read-only invariant, localhost-only, opaque IDs.
[RESTATE: Retrospective mode; verification only; plan closing is handled by pocket-closing stage after review.]

## DELIVERABLE
Coverage matrix complete: 4 rules × all GWTs → tests pass.
No scope drift: out-of-scope items absent.
Full suite: 30 pass, 0 fail.

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - Coverage matrix verified
  - 30/30 test suite passes

Must-not-have:
  - Any unverified acceptance criterion

## STOP CONDITIONS
Done when: DELIVERABLE complete and 30/30 passes
Escalate when: gap found

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Audit recursive walk, aggregation, deadlines, partials | prereq | standard | 7 Story 1 GWTs + 1 characterization test |
| T2 | Audit concurrency helper mapLimit | T1 | lightweight | 5 unit tests pass |
| T3 | Audit opaque node registry | T1 | lightweight | Registry test passes |
| T4 | Audit classification rules and guides | T1 | lightweight | Classification tests pass, 11 guides confirmed |
| T5 | Audit HTTP/SSE API contracts and read-only routes | T1 | standard | HTTP progressive scan & cancellation test passes |
| T6 | Audit frontend UI behaviors | T5 | standard | 7 UI regression tests pass |
| T7 | Audit read-only/Docker/security posture | T5 | standard review | 4 static safety tests pass; full suite 30/30 |
| T8 | Independent spec review and plan verification | T2,T3,T4,T5,T6,T7 | standard review | Coverage matrix complete + 30/30 suite |