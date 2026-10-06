# EXECUTION PLAN — Foundation Hardening — Cleanup Web Scanner

**Date:** 2026-10-02
**Spec:** docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
**Status:** draft
**Total tasks:** 7

---

## Execution Overview

### Recommended Order
```
T1 → T2, T4 (parallel) → T3, T5 (parallel) → T6 → T7
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T2, T4 | T1 completes |
| Group B | T3, T5 | T2 / T4 complete respectively |
| Group C | T6 | T5 completes |
| Group D | T7 | T6 completes |

### Constraints Reminder
**Architecture:** Zero runtime deps; no build step; additive API only; read-only invariant (`tests/read-only.test.js` explicit file list); layers touchable = root (package.json/.gitignore/README), `public/` (index.html/app.js/favicon.svg), `server.js` (headers + makeEntry only); NOT touchable = `lib/resolve-temp.js`, `lib/format.js`, `docker-compose.yml` hardening, whitelist logic.
**Out-of-scope:** Quick-scan backend / SSE / `?fast=1`, Windows container, native installer, auto-delete/exec affordance, database/auth/multi-user/scheduled tasks, adding/changing whitelist folders.
**Assumptions at risk:** Partial `reason` additive OK; CSP `style-src 'unsafe-inline'` acceptable; history retention 20 sufficient; sort desc ON + hideZero OFF defaults.
**Sequencing:** Dependency order shown is recommended only — pocket enforces actual blocking rules. Do not treat `[depends: TN]` as a hard lock unless the task cannot logically proceed without the prerequisite's output.

### File Structure Map

```
Rule: R1 — npm test
  Create: package.json                                  (created by: T1)
  Modify: (none)

Rule: R2 — git repo clean
  Create: .gitignore                                    (created by: T1)
  Create: .git/ (repo)                                  (created by: T1)

Rule: R3 — nul removed & ignored
  Delete: nul                                           (deleted by: T1)
  Modify: .dockerignore

Rule: R4 — Sort by size desc within group
  Modify: public/app.js  (renderScan, prefs helpers)
  Modify: public/index.html (toggle controls)
  Test:   tests/public.test.js

Rule: R5 — Hide zero folders
  Modify: public/app.js  (renderScan filter)
  Modify: public/index.html (toggle + chip)
  Test:   tests/public.test.js

Rule: R6 — Preferences persist
  Modify: public/app.js  (loadPrefs/savePrefs, key cleanupScanner.prefs.v1, default {sortBySizeDesc:true, hideZero:false})
  Test:   tests/public.test.js (shared localStorage across loads)

Rule: R7 — History stores 20 scans
  Modify: public/app.js  (history helpers, key cleanupScanner.history.v1)
  Test:   tests/public.test.js

Rule: R8 — Delta from last non-partial scan
  Modify: public/app.js  (findDeltaBaseline, delta render)
  Test:   tests/public.test.js

Rule: R9 — No delta on first scan
  Modify: public/app.js  (renderScan delta guard)
  Test:   tests/public.test.js

Rule: R10 — Mark cleaned stores timestamp
  Modify: public/app.js  (mark-cleaned listener, key cleanupScanner.lastCleanedAt)
  Modify: public/index.html (button)
  Test:   tests/public.test.js

Rule: R11 — Cleaned timestamp displayed
  Modify: public/app.js  (render relative time)
  Test:   tests/public.test.js

Rule: R12 — Favicon served
  Create: public/favicon.svg                            (created by: T7)
  Modify: public/index.html (<link rel="icon">)
  Test:   tests/server.test.js

Rule: R13 — CSP + security headers on all responses
  Modify: server.js  (securityHeaders helper, json(), serveStatic())
  Test:   tests/server.test.js

Rule: R14 — CSP allows inline style block
  Modify: server.js  (policy string style-src 'unsafe-inline')
  Test:   tests/server.test.js

Rule: R15 — Focus trap in modal
  Modify: public/app.js  (trapFocus, openFolderModal, closeFolderModal)
  Test:   tests/public.test.js

Rule: R16 — Partial entries have reason field
  Modify: server.js  (makeEntry signature + 5 call sites)
  Test:   tests/server.test.js

Rule: R17 — Frontend displays reason
  Modify: public/app.js  (renderFolderModal reason pill)
  Test:   tests/public.test.js

Rule: R18 — Native fallback documented
  Modify: README.md                                     (modified by: T1)

Rule: R19 — No read-only invariant violation (regression guard)
  Test:   tests/read-only.test.js — every task must keep green; verified explicitly in T7 Step 9

Rule: R20 — public/ asset guard passes (regression guard)
  Test:   tests/public.test.js scenario "public/ never uses exec/spawn or a hardcoded host:port" — every task must keep green; verified explicitly in T7 Step 9
```

---

## Pocket Packets

---

### Task 1: Repo foundation hygiene (package.json, git, nul, docs) [prereq] [no-tdd — structural task]

## OBJECTIVE
Establish repo hygiene so every later change is testable and revertible.

Steps:
1. Create `package.json` at repo root with `name: cleanup-web-scanner`, `version: 1.0.0`, `private: true` (no `type` field → default commonjs compatible with existing `require`), `scripts: { test: "node --test", start: "node server.js" }`, `engines: { node: ">=20" }`, `dependencies: {}`, zero runtime deps.
2. Create `.gitignore` containing at minimum: `nul`, `.env`, `.env.local`, `node_modules/`, `*.log`, `.scan.json`, `.scan.txt`, `*.tmp`, `.tmpcheck/`. Verify `.dockerignore` already contains `nul` (add if missing).
3. Remove stray file `nul` at repo root: from PowerShell `Remove-Item -LiteralPath .\nul -Force`. Verify `ls nul` fails.
4. Run `git init` (if no `.git`), `git branch -M main`, `git add` intentional files, initial commit `chore: init repo with stable baseline`. Verify `git status` shows only intentional files.
5. Update `README.md`: keep Docker section as primary, add `## Jalankan native (Windows)` section below Docker with `node server.js` instruction and note "Jika Docker Desktop tidak jalan, gunakan jalur native." Include Node version note.
6. Verify: `npm test` (or `node --test`) → 46+ pass; `git status` clean; `ls nul` → not found; `git check-ignore nul` → ignored.
7. Commit: `git commit -m "chore(repo): init package.json, gitignore, remove nul, document native fallback"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rules R1, R2, R3, R18 (Foundation Hygiene + Native Fallback).
server.js — `DEFAULT_PORT`, `resolveHost`.
tests/read-only.test.js — explicit file list (package.json/.gitignore not inspected; must not add forbidden patterns to inspected files).

## WHY THIS APPROACH
Complexity: lightweight
Justification: Structural scaffolding with no behavioral logic; no test doubles needed. Verifiable via shell commands. Must run first to unblock `npm test` and git history.

## SANDWICH CONTEXT
[CRITICAL: Zero runtime dependencies — never add a runtime dep; server.js must stay vanilla node:http.]
You are implementing T1 foundation hygiene for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — Incremental Hardening.
Files in scope: package.json (new), .gitignore (new), README.md, .dockerignore, nul (delete), .git/ (init). Must not touch lib/resolve-temp.js, lib/format.js, docker-compose.yml, public/app.js, server.js.
Available after: none (prereq)
Architecture rule: Zero runtime deps; additive changes only; preserve read-only invariant.
[RESTATE: Zero runtime dependencies — never add a runtime dep.]

## DELIVERABLE
[no-tdd — structural task] R1: Given package.json with "test": "node --test", When npm test, Then exit 0, 46+ pass.
R2: Given .gitignore with nul, .env, node_modules/, When git status, Then clean.
R3: Given nul deleted & in .gitignore, When ls nul, Then not found.
R18: Given README.md, When reading, Then section "Jalankan native (Windows)" exists with "node server.js".
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - package.json with `test: node --test`, zero deps; `npm test` passes
  - .gitignore covers nul, .env, node_modules/
  - nul deleted and ignored by git and docker
  - README native section present with node server.js
  - git branch main, initial commit present
  - [no-tdd — structural task]

Must-not-have:
  - Any runtime dependency added
  - Whitelist/API contract changes
  - Touching lib/resolve-temp.js or docker-compose.yml

Open question risks:
  - None blocking for this task

Rollback note:
  - `git revert` the commit

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Must-not behavior (new dep) → STOP

## STOP CONDITIONS
Done when: `npm test` 46+ pass, `git status` clean, nul absent/ignored, README native section present, no forbidden patterns introduced.
Uncertain when: `npm test` fails due to Node <20 → report NEEDS_CONTEXT with Node version.
Escalate when: forbidden pattern detected in new files.

---

### Task 2: Backend — partial reason field on scan entries [depends: T1]

## OBJECTIVE
Add additive optional `reason` field to scan entry JSON so frontend can display *why* a folder is partial.

**Deterministic contract:** `makeEntry(folder, status, fileCount, sizeBytes, reason)` — the `reason` key is PRESENT (string) ONLY when `status === 'partial' || status === 'access_denied'` and reason is truthy. The key is ABSENT otherwise (`ready` / `not_found`).

Steps:
1. Write failing test for: Partial entry includes reason field (timeout) [R16]
   Test file: `tests/server.test.js`
   Level: integration (createServer + fetch /api/scan with mocked fs timeout)
   Test intent: Given folder scan times out (context timeout via mocked clock/fs), When GET /api/scan, Then entry for that folder has status "partial" And entry.reason === "timeout"
   Exercise through: `createServer` HTTP boundary backed by `scanAll`
   Test doubles: Mock `fs` (readdir/stat that exceeds timeout) and mock `now` clock to trigger `hasTimedOut`; do NOT mock `makeEntry`, `walkFolder`, or `scanAll`
   Expected RED: `entry.reason` is absent (field not yet added)
2. Run test — verify FAIL: `node --test tests/server.test.js`

3. Implement in `server.js` **timeout mapping only**:
   - `function makeEntry(folder, status, fileCount = 0, sizeBytes = 0, reason)`; build base object; add `reason` only when `(status === 'partial' || status === 'access_denied') && reason`.
   - Update the 2 timeout-related call sites: `hasTimedOut` branch → `'timeout'`; outer `hasTimedOut(context)` loop → `'timeout'`. Leave `skipped>10%` and `catch isAccessDenied` without reason for now (they pass `undefined`).
   - Verify PASS: `node --test tests/server.test.js --test-name-pattern="Partial entry includes reason field (timeout)"`

4. Write failing test for: Skipped files partial includes count [R16]
   Test file: `tests/server.test.js`
   Level: unit (walkFolder helper)
   Test intent: Given folder has 100 files, 15 skipped (locked), When scan completes, Then entry.reason === "skipped=15"
   Exercise through: `walkFolder` with mocked fs returning 15 entries that throw
   Test doubles: Mock fs entries where 15 throw `EPERM`; do NOT mock walkFolder itself
   Expected RED: reason is `'timeout'` or absent, not `'skipped=15'`
5. Run test — verify FAIL: `node --test tests/server.test.js`

6. Implement skipped reason mapping (pass `'skipped=' + skipped` when `skipRatio > 0.10`), verify PASS.

7. Write failing test for: Access denied partial includes reason [R16]
   Test file: `tests/server.test.js`
   Level: unit (scanFolder error path)
   Test intent: Given `walkFolder` rejects with EACCES, When `scanFolder` completes, Then entry.reason === "access_denied"
   Exercise through: `scanFolder` with mocked `walkFolder` rejecting EACCES
   Test doubles: Mock `walkFolder` to reject EACCES; do NOT mock scanFolder itself
   Expected RED: reason is `'timeout'` or absent
8. Run test — verify FAIL: `node --test tests/server.test.js`

9. Implement access_denied reason mapping, verify PASS, refactor while green, commit: `git commit -m "feat(server): add reason field to partial scan entries"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rule R16 (Story 9).
server.js:13-160 (`resolveTimeoutMs`, `makeEntry` line 145), 261 (`walkFolder`), 333 (`scanFolder`), 370 (`scanAll`).
tests/server.test.js — existing field-by-field asserts.

## WHY THIS APPROACH
Complexity: standard
Justification: 5 call sites, branching timeout/skipped/access_denied mapping; careful to keep existing field asserts green. No new deps.

## SANDWICH CONTEXT
[CRITICAL: Read-only invariant — never add fs.writeFile/unlink/rm or child_process spawn/exec.]
You are implementing T2 backend reason field for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — additive optional reason field, present only for partial/access_denied.
Files in scope: server.js (makeEntry + scanFolder/walkFolder/scanAll), tests/server.test.js.
Available after: T1
Architecture rule: Additive field only; do not change whitelist logic.
[RESTATE: Read-only invariant — never add destructive fs or child_process calls.]

## DELIVERABLE
Given folder scan times out, When GET /api/scan, Then entry.status "partial" And entry.reason == "timeout"
Given folder has 100 files 15 skipped, When scan, Then entry.reason == "skipped=15"
Given walkFolder EACCES, When scanFolder, Then entry.reason == "access_denied"
Given status ready/not_found, Then entry.reason key absent
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - makeEntry 5th optional param `reason`
  - 5 call sites propagate correct reason
  - reason key absent for ready/not_found
  - Existing server.test.js asserts pass; new reason asserts pass

Must-not-have:
  - Changing whitelist folders
  - Adding write/delete/spawn patterns
  - reason key present on ready/not_found entries

Open question risks:
  - Additive API assumed OK → tests assert individual fields, so safe

Rollback note:
  - Revert commit; reason disappears; T7 badge degrades gracefully

Red flags:
  - Modifying lib/resolve-temp.js or docker-compose.yml → DONE_WITH_CONCERNS
  - Adding forbidden pattern → STOP

## STOP CONDITIONS
Done when: DELIVERABLE GWT pass, `node --test tests/server.test.js` green, `node --test tests/read-only.test.js` green.
Uncertain when: skipped threshold logic unclear → NEEDS_CONTEXT.
Escalate when: read-only guard fails.

---

### Task 3: Security headers — CSP + nosniff + referrer + frame deny [depends: T2]

## OBJECTIVE
Add CSP and security headers to every HTTP response without breaking the inline `<style>` block or `fetch('/api/scan')`.

Steps:
1. Write failing test for: CSP header present on all responses [R13]
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given server running, When GET /, /app.js, /api/scan, Then each response has `content-security-policy` including `default-src 'self'`, `script-src 'self'`, `connect-src 'self'`; And `x-content-type-options: nosniff`; And `referrer-policy: no-referrer`; And `x-frame-options: DENY`
   Exercise through: `createServer` HTTP boundary (real server on ephemeral port)
   Test doubles: None
   Expected RED: CSP header missing (undefined)
2. Run test — verify FAIL: `node --test tests/server.test.js`

3. Implement in `server.js` **CSP without unsafe-inline first**:
   - Add a security-headers helper returning the CSP policy per spec R13 but with the style-src directive restricted to `'self'` only (no `unsafe-inline`), plus the three additional security headers per spec R13.
   - Merge the helper into the JSON response path and the static-file response path.
   - Verify PASS for R13 test: `node --test tests/server.test.js --test-name-pattern="CSP header present"`

4. Write failing test for: CSP declares inline-style allowance [R14]
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given index.html has a single `<style>` block, When GET /, Then the `content-security-policy` header's style-src directive includes `'unsafe-inline'`
   Exercise through: `createServer` GET /
   Test doubles: None
   Expected RED: style-src directive lacks `'unsafe-inline'` (policy is `style-src 'self'`)
5. Run test — verify FAIL: `node --test tests/server.test.js --test-name-pattern="CSP declares inline-style allowance"`

6. Add `'unsafe-inline'` to the CSP style-src directive in the security-headers helper and verify PASS for R14, commit: `git commit -m "feat(server): add CSP and security headers to all responses"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rules R13, R14 (Story 7).
server.js:36-45 (`json`), 426-470 (`serveStatic`), 462-492 (`createServer`).
public/index.html:7 — single `<style>` block (justifies unsafe-inline).

## WHY THIS APPROACH
Complexity: lightweight
Justification: One helper + two call sites. Verifiable via header asserts.

## SANDWICH CONTEXT
[CRITICAL: Read-only invariant; CSP must not block existing <style> block or fetch('/api/scan').]
You are implementing T3 security headers for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — style-src 'unsafe-inline' justified by single <style> block, no build step.
Files in scope: server.js (header helper + json/serveStatic), tests/server.test.js.
Available after: T2
Architecture rule: Headers on every response; policy exact as spec; zero deps.
[RESTATE: Never add destructive patterns; CSP must allow existing style block.]

## DELIVERABLE
Given server running, When GET /, /app.js, /api/scan, Then CSP + nosniff + no-referrer + DENY present
Given index.html has <style>, When GET /, Then CSP style-src includes 'unsafe-inline'
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - CSP exact policy on every route including 404/500
  - Three additional security headers
  - Existing tests still pass

Must-not-have:
  - Blocking inline style
  - Blocking app.js or /api/scan fetch
  - Adding a dependency (helmet etc.)

Open question risks:
  - CSP unsafe-inline acceptable; if auditor requires nonce → would need build step

Rollback note:
  - Revert commit; remove helper

Red flags:
  - New dependency → STOP
  - Touching docker-compose.yml → STOP

## STOP CONDITIONS
Done when: header asserts pass, `node --test` green, manual `curl -I /` shows CSP.
Uncertain when: policy debated → NEEDS_CONTEXT.
Escalate when: read-only guard fails.

---

### Task 4: Test mock fix + sort by size + hide-zero + prefs persistence [depends: T1]

## OBJECTIVE
First unblock the vm test harness (localStorage mock), then make 15-card scan results scannable: sort descending by size within each group, hide zero-byte folders, persist prefs.

Steps:
1. **Mock prerequisite (B1 fix):** Add a Map-backed `localStorage` mock to `tests/public.test.js` `loadApp()` and inject it as both global `localStorage` and `window.localStorage` in the vm context. Mock must implement `getItem`, `setItem`, `removeItem`, `clear`, `key(i)`, and a `length` accessor. Accept an optional injected store so two `loadApp` calls can share state (needed by R6). This step is a structural enabler with no behavioral GWT of its own; verify it does not break existing scenarios: `node --test tests/public.test.js` stays green.
2. Write failing test for: Cards sorted by size descending within group [R4]
   Test file: `tests/public.test.js`
   Level: unit (vm context)
   Test intent: Given scan payload with Temp group: `Local\Temp` sizeBytes 2362232012 and `Windows\Temp` sizeBytes 741376, When `renderScan` renders, Then the first card in the Temp group's DOM is `Local\Temp` And second is `Windows\Temp`
   Exercise through: `loadApp` vm context → `window.cleanupScanner.renderScan(payload)` → inspect `document.getElementById('results-content')` children
   Test doubles: Mock `fetch` (payload) and `localStorage` (from step 1); do NOT mock `renderScan`/`renderCard`
   Expected RED: cards in payload insertion order (unsorted)
3. Run test — verify FAIL: `node --test tests/public.test.js`

4. Implement in `public/app.js` **sort only, in-memory prefs (no persistence yet)**:
   - Add an in-memory prefs object on app state with sort-descending default ON and hide-zero default OFF (values per spec, no literal key names).
   - In `renderScan(data)`: sort each group's entries by `sizeBytes` descending when sort-descending is on (stable tie-break by original index).
   - In `public/index.html`: add a sort-descending control (checked by default) in the results tab. Wire its listener to mutate prefs and re-render from the last scan data.
   - `init()` reflects the control state from prefs.
   - Verify PASS for the R4 sort test: `node --test tests/public.test.js`

5. Write failing test for: Hide zero folders toggles visibility + chip restore [R5]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given payload with 12 zero-byte folders and 3 non-zero, When user clicks hideZero toggle ON, Then zero folders absent from DOM And chip shows "12 folder kosong disembunyikan" And clicking chip restores them
   Exercise through: `loadApp` → `renderScan` → dispatch click on toggle → inspect DOM
   Test doubles: Mock fetch + localStorage (step 1)
   Expected RED: zero folders still visible, chip absent (only sort implemented in step 4)
6. Run test — verify FAIL: `node --test tests/public.test.js`

7. Implement hide-zero filter + chip: add a hide-zero control (unchecked by default) and a hidden-count chip container in the results tab; when hide-zero is on, omit zero-byte/zero-file entries from the DOM while keeping them in the total; chip shows hidden count and restores on click. Verify PASS for R5.

8. Write failing test for: Preferences persist across reload [R6]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given user toggled hideZero ON and sort OFF (shared store), When a second `loadApp` runs with the same localStorage store, Then hideZero still ON And sort still OFF
   Exercise through: two `loadApp` calls sharing the store → inspect prefs/DOM
   Test doubles: Shared localStorage Map across two loads
   Expected RED: prefs reset to defaults on reload (no persistence implemented yet)
9. Run test — verify FAIL: `node --test tests/public.test.js`

10. Implement persistence in `public/app.js` using the versioned prefs key from spec (R6): a load function (try/catch around JSON parse, defaults per spec) and a save function (try/catch around setItem); `init()` loads prefs and toggle listeners save them. Verify PASS for R6.
11. Refactor while green, commit: `git commit -m "feat(web): sort by size, hide-zero toggle, prefs persistence"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rules R4, R5, R6 (Stories 2+3), blocking finding B1.
public/app.js:748-870 (`renderCard`, `renderScan`, GROUP_ORDER, GROUP_LABELS).
public/index.html:481-495 (results tab structure).
tests/public.test.js:95-180 (`loadApp`, `makeDocument`, vm context).

## WHY THIS APPROACH
Complexity: standard
Justification: Cross-cutting: mock fix + two features + persistence. Logic isolated to prefs + sort/filter; requires DOM inspection in tests.

## SANDWICH CONTEXT
[CRITICAL: public/ must never contain child_process/spawn/exec/execFile or hardcoded host:port.]
You are implementing T4 sort/hide/prefs for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — localStorage `cleanupScanner.prefs.v1`, sort desc ON default, hideZero OFF default.
Files in scope: public/app.js, public/index.html, tests/public.test.js.
Available after: T1
Architecture rule: Zero deps; prefs key versioned v1; try/catch around JSON parse.
[RESTATE: public/ must never contain forbidden patterns or hardcoded host:port.]

## DELIVERABLE
Given Local\Temp 2.2GB, Windows\Temp 724KB, When render, Then Local\Temp first
Given 12 zero folders, When toggle ON, Then hidden, chip "12 folder kosong disembunyikan", chip restores
Given toggles set, When reload (shared store), Then state restored
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - localStorage mock in loadApp (Map-backed, full API, injectable store)
  - Sort desc within group + stable tie-break
  - Hide-zero filter + chip + restore
  - Prefs persistence via cleanupScanner.prefs.v1 with try/catch
  - All existing public.test.js scenarios still pass

Must-not-have:
  - Hardcoded host:port in public files
  - exec/spawn patterns

Open question risks:
  - Sort default desc ON assumed

Rollback note:
  - Revert commit; controls disappear, key orphaned (harmless)

Red flags:
  - Mocking renderScan itself → STOP
  - Modifying server.js → out of scope

## STOP CONDITIONS
Done when: sorting, hide-zero, persistence GWT pass, `node --test tests/public.test.js` green.
Uncertain when: localStorage quota edge → NEEDS_CONTEXT.
Escalate when: asset guard fails.

---

### Task 5: Frontend — scan history, delta vs last non-partial, mark cleaned [depends: T4]

## OBJECTIVE
Give before/after feedback: store scan history (max 20, FIFO), show delta vs last non-partial scan, allow local "sudah dibersihkan" annotation.

Steps:
1. Write failing test for: History stores up to 20 scans [R7]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given 21 successful scans with incrementing totalBytes, When reading `localStorage` key `cleanupScanner.history.v1`, Then array length = 20 And the oldest entry corresponds to scan #2
   Exercise through: `loadApp` → repeated `renderScan`/scan cycles → inspect history key
   Test doubles: Mock fetch + localStorage; do NOT mock history helpers
   Expected RED: history key absent, or length 21 (no FIFO)
2. Run test — verify FAIL: `node --test tests/public.test.js`

3. Implement in `public/app.js` using the versioned storage keys from spec (R6):
   - A history load/save pair (try parse, default empty; push snapshot of scannedAt/totalBytes/partial/entries metadata, keep newest 20).
   - After a successful scan fetch, save a snapshot of the result.
   - Verify PASS for the R7 history test: `node --test tests/public.test.js`

4. Write failing test for: Delta displayed vs last non-partial scan [R8]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given history has a non-partial baseline totalBytes 2500000000 and current scan totalBytes 1100000000, When `renderScan` renders, Then UI shows delta text containing "Turun" And a human size (~1,4 GB) And the relative time of the baseline
   Exercise through: `loadApp` → seed history in localStorage → `renderScan` → inspect delta DOM element
   Test doubles: Mock fetch + localStorage + `Date.now` for relative time
   Expected RED: delta text absent
5. Run test — verify FAIL: `node --test tests/public.test.js`

6. Implement a delta-baseline helper (walk history backwards for the first non-partial entry before the current) and render the delta unconditionally into a new delta element. **Intermediate state:** when no valid baseline exists, render the delta element anyway with a zero-drop placeholder ("Turun" plus zero size); this deliberately leaves the empty-baseline case unguarded so the R9 cycle can fail RED. Verify PASS for the seeded-baseline case from step 4 (run that test by name).

7. Write failing test for: Partial scans excluded from delta baseline [R8 edge]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given history: scan1 (partial, 1.1GB), scan2 (ready, 2.5GB), scan3 (ready, 1.0GB), When scan3 renders, Then delta computed vs scan2 → "Turun 1,5 GB sejak <scan2 time>"
   Exercise through: seed history → renderScan → inspect delta
   Test doubles: Mock fetch + localStorage + Date.now
   Expected RED: delta computed vs scan1 (partial) or absent
8. Run test — verify FAIL: `node --test tests/public.test.js`
9. Implement the partial-skip in the delta-baseline helper, verify PASS.

10. Write failing test for: No delta on first scan [R9]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given empty history, When first scan completes, Then UI shows only "Terakhir dipindai" And no delta text
   Exercise through: `loadApp` with empty store → renderScan → inspect
   Test doubles: Mock fetch + localStorage
   Expected RED: delta element still renders the zero-drop placeholder because step 6 renders unconditionally
11. Run test — verify FAIL: `node --test tests/public.test.js`; add the empty-baseline guard (only render delta when a valid non-self, non-partial baseline with strictly larger totalBytes exists), verify PASS.

12. Write failing test for: Mark cleaned stores timestamp [R10]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given a completed scan, When user clicks the cleaned button, Then the versioned last-cleaned key in localStorage is set to an ISO time
   Exercise through: `loadApp` → renderScan → click the mark-cleaned control → inspect localStorage
   Test doubles: Mock fetch + localStorage + Date
   Expected RED: key not set
13. Run test — verify FAIL: `node --test tests/public.test.js`; implement button + listener (add the control to `public/index.html`), verify PASS.

14. Write failing test for: Cleaned timestamp displayed [R11]
    Test file: `tests/public.test.js`
    Level: unit
    Test intent: Given a stored last-cleaned time = 2 hours ago, When page loaded, Then UI shows "Terakhir dibersihkan: 2 jam lalu"
    Exercise through: seed localStorage → `loadApp` → inspect display
    Test doubles: Mock fetch + localStorage + Date
    Expected RED: cleaned text absent
15. Run test — verify FAIL; implement relative-time display, verify PASS.

16. Write failing test for: Cleaned timestamp never affects scan or delta [R10 edge]
    Test file: `tests/public.test.js`
    Level: unit
    Test intent: Given a stored last-cleaned time exists And seeded history with a non-partial baseline, When a new scan runs and renders, Then scan totals are independent of the cleaned time And delta is computed vs the previous scan baseline (not vs last-cleaned time)
    Exercise through: seed localStorage → `loadApp` → renderScan → inspect totals + delta
    Test doubles: Mock fetch + localStorage + Date
    Expected RED: delta incorrectly based on the cleaned time, or scan totals affected
17. Run test — verify FAIL; enforce independence (history/delta never read the cleaned key), verify PASS; refactor while green, commit: `git commit -m "feat(web): scan history, delta, and mark cleaned"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rules R7, R8, R9, R10, R11 (Stories 4+5), findings B2, N2, N6.
public/app.js:791-935 (`renderScan`, `scan`, `init`, `els`).
lib/format.js — `sizeHuman` (reuse).
tests/public.test.js — loadApp + localStorage mock from T4.

## WHY THIS APPROACH
Complexity: standard
Justification: localStorage state machine (FIFO, baseline walk) + UI; multiple GWT but cohesive storage area; needs relative-time formatting.

## SANDWICH CONTEXT
[CRITICAL: public/ must never contain forbidden patterns; history is localStorage-only, never sent to server.]
You are implementing T5 history/delta/cleaned for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — localStorage v1, 20 FIFO, delta vs last non-partial, cleaned is local annotation.
Files in scope: public/app.js, public/index.html, tests/public.test.js.
Available after: T4
Architecture rule: No API change for history; additive localStorage keys only.
[RESTATE: History is localStorage-only, never sent to server; never add forbidden patterns.]

## DELIVERABLE
Given 21 scans, Then history length 20, oldest dropped
Given last non-partial 2.5GB, current 1.1GB, Then "Turun 1,4 GB sejak <time>"
Given history scan1 partial, Then delta vs scan2 not scan1
Given empty history, Then only "Terakhir dipindai"
Given scan done + click "✓ Sudah dibersihkan", Then lastCleanedAt set And "Terakhir dibersihkan: 2 jam lalu" And scan unaffected
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - History 20 FIFO after 21 saves
  - Delta vs last non-partial (partial skipped)
  - No delta on first scan
  - Mark cleaned saves ISO string + displays relative time
  - Mark cleaned never affects scan/delta
  - try/catch on JSON parse

Must-not-have:
  - Sending history to server
  - Using a partial entry as delta baseline

Open question risks:
  - History 20 assumed enough

Rollback note:
  - Revert commit; keys orphaned but harmless

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Mocking history helper instead of exercising via renderScan → STOP

## STOP CONDITIONS
Done when: history FIFO, delta non-partial, no-delta-first, mark cleaned GWT pass.
Uncertain when: relative time formatting ambiguous → NEEDS_CONTEXT.
Escalate when: asset guard fails.

---

### Task 6: Frontend — focus-trap modal [depends: T5]

## OBJECTIVE
Make the folder guide modal keyboard-safe: Tab/Shift+Tab cycle within the modal, focus moves to the close button on open, and focus is restored to the trigger on close.

Steps:
1. Write failing test for: Tab cycles within modal [R15]
   Test file: `tests/public.test.js`
   Level: unit (vm context)
   Test intent: Given the modal is open, When the user presses Tab on the last focusable element, Then focus moves to the first focusable element in the modal
   Exercise through: `loadApp` → `openFolderModal(entry)` → dispatch `keydown` Tab → inspect `document.activeElement`
   Test doubles: Mock `document.activeElement` tracking (the Element mock records focus calls); do NOT mock the trap helper
   Expected RED: focus stays on last element / no wrap
2. Run test — verify FAIL: `node --test tests/public.test.js`

3. Implement in `public/app.js` **Tab-wrap only (do NOT implement focus-restore yet)**:
   - Add a trapFocus helper that collects focusable elements inside the modal and attaches a keydown listener for Tab/Shift+Tab that wraps focus.
   - `openFolderModal(entry)`: focus the close button after showing (do NOT save `lastFocused` yet — that comes in step 4).
   - In `tests/public.test.js`: ensure the Element mock tracks focus (add `focus()` that sets a shared `document.activeElement` if not already present).
   - Verify PASS: `node --test tests/public.test.js`

4. Write failing test for: Focus restored on close [R15]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given card X is focused and the user opens the modal then closes it (Escape), Then focus returns to card X
   Exercise through: `loadApp` → focus card → open → close → inspect activeElement
   Test doubles: Same as above
   Expected RED: focus not restored (only Tab-wrap implemented in step 3)
5. Run test — verify FAIL: `node --test tests/public.test.js`; implement save-lastFocused-on-open + restore-on-close, verify PASS; refactor while green, commit: `git commit -m "feat(web): focus-trap the folder guide modal"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rule R15 (Story 8).
public/app.js:729-760 (`openFolderModal`, `closeFolderModal`), 913-935 (`handleKeydown`, `init`).
tests/public.test.js — Element mock, loadApp.

## WHY THIS APPROACH
Complexity: standard
Justification: Keyboard behavior requires focus tracking in the test mock; isolated to modal open/close.

## SANDWICH CONTEXT
[CRITICAL: public/ must never contain forbidden patterns.]
You are implementing T6 focus trap for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — Tab wraps within modal, restore lastFocused on close.
Files in scope: public/app.js, tests/public.test.js.
Available after: T5
Architecture rule: Zero deps; no querySelectorAll dependency beyond DOM APIs.
[RESTATE: public/ must never contain forbidden patterns.]

## DELIVERABLE
Given modal open, When Tab on last, Then focus wraps to first
Given Shift+Tab on first, Then wraps to last
Given card focused + modal opened then closed, Then focus restored to card
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tab/Shift+Tab wrap within modal
  - Focus close button on open
  - Restore lastFocused on close
  - Prior tests still green

Must-not-have:
  - Forbidden patterns
  - Breaking sort/hide/history from T4/T5

Open question risks:
  - Element mock may need focus tracking

Rollback note:
  - Revert commit; trap disabled

Red flags:
  - Adding npm dep → STOP

## STOP CONDITIONS
Done when: focus trap GWT pass, `node --test tests/public.test.js` green.
Uncertain when: mock needs selector support → NEEDS_CONTEXT.
Escalate when: asset guard fails.

---

### Task 7: Favicon + partial reason badge + regression verification [depends: T2, T3, T6]

## OBJECTIVE
Serve a favicon, surface the partial `reason` in the folder modal, and run explicit regression verification for the read-only invariant and asset guard (R19, R20).

Steps:
1. Write failing test for: Favicon served correctly [R12]
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given `public/favicon.svg` exists, When GET /favicon.svg, Then status 200 And content-type image/svg+xml And CSP header present
   Exercise through: `createServer` + fetch `/favicon.svg` (serveStatic path)
   Test doubles: None
   Expected RED: 404 (file does not exist yet)
2. Run test — verify FAIL: `node --test tests/server.test.js`

3. Implement:
   - Create `public/favicon.svg` — a minimal 32×32 SVG placeholder (no forbidden substrings).
   - Add `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` in `public/index.html` `<head>`. Confirm `server.js` `contentType()` maps `.svg` → `image/svg+xml`.
   - Verify PASS: `node --test tests/server.test.js`

4. Write failing test for: Partial reason badge visible in modal [R17]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given an entry with `status: 'partial'` and `reason: 'timeout'`, When the folder modal opens, Then the modal DOM contains text "Alasan: timeout"
   Exercise through: `loadApp` → `openFolderModal(entry)` → inspect modal body text
   Test doubles: None (entry passed directly); do NOT mock the modal renderer
   Expected RED: badge text absent
5. Run test — verify FAIL: `node --test tests/public.test.js`

6. Implement in `public/app.js` `renderFolderModal(entry)`: when `entry.reason` is present, render `<span class="reason-pill">Alasan: <reason></span>` (warning style). Handles `timeout`, `skipped=N`, `access_denied`. Verify PASS.

7. Write failing test for: Reason badge for skipped and access_denied [R17]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given entry reason `'skipped=15'` then `'access_denied'`, When modal opens each time, Then "Alasan: skipped=15" and "Alasan: access_denied" render respectively
   Exercise through: `openFolderModal` with each entry
   Test doubles: None
   Expected RED: badge text absent for those values
8. Run, implement/confirm, verify PASS.

9. **Explicit regression verification (R19, R20):**
   - Run `node --test tests/read-only.test.js` → must be green (no new forbidden patterns in server.js/public).
   - Run `node --test tests/public.test.js` → the scenario "public/ never uses exec/spawn or a hardcoded host:port" must pass (favicon.svg included in `public/` scan).
   - Run the full suite `node --test tests/*.test.js` (or `npm test`) → all green.
10. Refactor while green, commit: `git commit -m "feat(web): favicon and partial reason badge; verify read-only guards"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rules R12 (favicon), R17 (reason display), R19/R20 (regression guards).
server.js:411-430 (`contentType`), 426-470 (`serveStatic` with CSP from T3).
public/app.js:643-760 (`renderFolderModal`, `openFolderModal`).
public/index.html:1-20 (`<head>`).
tests/public.test.js (asset guard at ~line 479), tests/read-only.test.js.

## WHY THIS APPROACH
Complexity: standard
Justification: Two small features (static asset + badge) plus an explicit regression gate for the read-only invariant and asset guard, which the spec calls out as acceptance rules.

## SANDWICH CONTEXT
[CRITICAL: public/favicon.svg must not contain forbidden substrings; CSP headers must still apply to .svg.]
You are implementing T7 favicon + reason badge + regression for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — SVG file (not data URI); reason pill in modal.
Files in scope: public/favicon.svg (new), public/index.html, public/app.js, tests/public.test.js, tests/server.test.js.
Available after: T2 (reason field), T6 (modal focus work)
Architecture rule: Zero deps; favicon via existing serveStatic; read-only guards must stay green.
[RESTATE: favicon must not contain forbidden substrings; read-only + asset guards must pass.]

## DELIVERABLE
Given favicon.svg, When GET /favicon.svg, Then 200 image/svg+xml And CSP present
Given entry reason "timeout", When modal opens, Then "Alasan: timeout" visible
Given reason "skipped=15" / "access_denied", Then respective badges visible
Given full suite, When run, Then read-only and asset guards green
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - favicon.svg served 200 with correct content-type + CSP
  - <link rel="icon"> in index.html
  - Reason badge for timeout/skipped/access_denied
  - read-only.test.js green; public asset guard green; full suite green

Must-not-have:
  - Forbidden substrings in svg
  - Hardcoded host:port
  - Breaking sort/hide/history from T4/T5 or focus trap from T6

Open question risks:
  - None blocking

Rollback note:
  - Revert commit; favicon 404 returns, badge hidden

Red flags:
  - Adding npm dep → STOP
  - Modifying docker-compose.yml → STOP

## STOP CONDITIONS
Done when: favicon + reason badge GWT pass, read-only + asset guards green, `npm test` fully green.
Uncertain when: contentType needs svg mapping added → NEEDS_CONTEXT.
Escalate when: read-only or asset guard fails.

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Repo foundation hygiene | prereq | lightweight | npm test 46+ pass, git clean, nul gone |
| T2 | Backend partial reason field | T1 | standard | reason timeout / skipped=15 / access_denied; absent when ready |
| T3 | Security headers CSP | T2 | lightweight | CSP + 3 headers on every response; style-src unsafe-inline |
| T4 | Mock fix + sort + hide-zero + prefs | T1 | standard | sort desc, hide-zero + chip, prefs persist |
| T5 | History/delta/mark cleaned | T4 | standard | 20 FIFO, delta vs non-partial, cleaned stamp |
| T6 | Focus-trap modal | T5 | standard | Tab wraps, focus restored |
| T7 | Favicon + reason badge + regression | T2, T3, T6 | standard | 200 svg, "Alasan: timeout", guards green |
