# EXECUTION PLAN — Cleanup Web Scanner

**Date:** 2026-09-29
**Spec:** docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md
**Status:** draft
**Total tasks:** 4

---

## Execution Overview

### Recommended Order
```
T1 → T2, T3 (parallel) → T4
```

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T2, T3 | T1 completes |

### Constraints Reminder
**Architecture:**
- `[CRITICAL]` Read-only invariant: no `fs.writeFile`, `fs.unlink`, `fs.rm`, `spawn`, `exec` anywhere (only `read-only registry execFile('reg', ['query', ...])` is permitted for resolve-temp fallback)
- `[CRITICAL]` Whitelist-only scan (5 paths); do NOT follow symlink/junction (`lstat`)
- `[CRITICAL]` Bind 127.0.0.1 only; same-origin serve frontend from the same process
**Out-of-scope:** auto-delete, scheduling, browser caches, Windows.old, Installer, user data folders, per-file detail UI, Open-in-Explorer button, auth/HTTPS/bind 0.0.0.0/remote access, per-file age backend
**Assumptions at risk:**
- sizeHuman = 1024 base, 1 decimal, en locale
- `scannedAt` = end of scan, local offset ISO-8601
- `partial` = ≥1 entry `partial`
- resolve-user-temp = registry `User Shell Folders\Local AppData`, fallback `%LOCALAPPDATA%\Temp`
**Sequencing:** T1 provides helpers + contract shape; T2 and T3 can implement independently.

### File Structure Map

```
Rule: Whitelist scan + walk + status logic + 404/405 + bind localhost + startup messages
  Create: lib/resolve-temp.js          (T1)
  Create: lib/format.js                (T1)
  Create: server.js                    (T2)
  Create: start.bat                    (T2)
  Test:   tests/resolve-temp.test.js   (T1)
  Test:   tests/format.test.js         (T1)
  Test:   tests/server.test.js         (T2)
  Test:   tests/startup.test.js        (T2)

Rule: Frontend refresh/race + guide + auto-scan
  Create: public/index.html            (T3)
  Create: public/app.js                (T3)
  Test:   tests/public.test.js         (T3)

Rule: Read-only invariant (audit)
  Test:   tests/read-only.test.js      (T4)
```

---

## Pocket Packets

---

### Task 1: Shared helpers + contract shape [prereq]

## OBJECTIVE
Create the reusable pieces that T2 (backend) and T3 (frontend) both depend on:
- Resolve logged-in user Temp path safely (registry lookup, fallback env)
- `sizeHuman` formatter (1024 base, 1 decimal, en, "0 B")
- Document the exact JSON contract shape used by both sides

Steps:
1. Write failing test for: `resolveTemp() returns logged-in user Temp path when elevated`
   Test file: `tests/resolve-temp.test.js`
   Level: unit
   Test intent: Given `process.env.TEMP` points to a non-user-local Temp (elevated scenario), When `resolveTemp()` is called, Then it returns `C:\Users\<user>\AppData\Local\Temp` (logged-in user path)
   Exercise through: public `resolveTemp()` function
   Test doubles: stub `process.env` + stub `execFile` (registry read-only)
   Expected RED: function not implemented → ReferenceError or assertion mismatch
2. Run test — verify FAIL: `node --test tests/resolve-temp.test.js`
3. Implement `lib/resolve-temp.js` (registry lookup + fallback) → verify PASS → commit: `feat(resolve-temp): resolve logged-in user temp safely`
4. Write failing test for: `sizeHuman formats 0 B`
   Test file: `tests/format.test.js`
   Level: unit
   Test intent: Given `sizeBytes=0`, When `sizeHuman(0)`, Then returns `"0 B"`
   Exercise through: public `sizeHuman()` function
   Test doubles: none
   Expected RED: function not implemented → ReferenceError
5. Run test — verify FAIL: `node --test tests/format.test.js`
6. Implement `lib/format.js` (sizeHuman + contract shape documentation via JSDoc) → verify PASS → commit: `feat(format): sizeHuman 1024-based, 1 decimal, en`

7. Write failing test for: `sizeHuman formats 2.5 GB`
   Test file: `tests/format.test.js`
   Level: unit
   Test intent: Given `sizeBytes=2684354560`, When `sizeHuman(...)` is called, Then returns `"2.5 GB"`
   Exercise through: public `sizeHuman()` function
   Test doubles: none
   Expected RED: formatting not implemented or wrong base/decimal → ReferenceError or mismatch
8. Run test — verify FAIL: `node --test tests/format.test.js`
9. Implement `lib/format.js` (sizeHuman + contract shape documentation via JSDoc) → verify PASS → commit: `feat(format): sizeHuman 1024-based, 1 decimal, en`
10. Write failing test for: `resolveTemp falls back to %LOCALAPPDATA%\\Temp when registry query fails`
   Test file: `tests/resolve-temp.test.js`
   Level: unit
   Test intent: Given the read-only registry query returns no Local AppData entry, When `resolveTemp()` is called, Then it returns the `%LOCALAPPDATA%\\Temp` fallback path
   Exercise through: public `resolveTemp()` function
   Test doubles: stub `process.env` + registry stub returning empty/error
   Expected RED: dual-path logic not implemented → ReferenceError or mismatch
11. Run test — verify FAIL: `node --test tests/resolve-temp.test.js`
12. Implement registry-fallback dual path → verify PASS → commit: `fix(resolve-temp): registry fallback to LOCALAPPDATA Temp`

## REFERENCES LOADED
`docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md` — Rule 6 (elevation-safe target), sizeHuman format assumption

## WHY THIS APPROACH
Complexity: lightweight
Justification: Two small pure helpers, no side effects. Extracted per Shared Helper Pattern so T2/T3 don't reimplement.

## SANDWICH CONTEXT
[CRITICAL: Resolve-temp must be read-only registry query only (no writes)]
[CRITICAL: sizeHuman must use 1024 base, 1 decimal, en locale, "0 B" exact string]
You are implementing shared helpers for Cleanup Web Scanner.
Spec: docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md
Design decision: Option A — node:http core-only, zero dependency
Files in scope: lib/resolve-temp.js, lib/format.js, tests/resolve-temp.test.js, tests/format.test.js
Available after: none (prereq)
Architecture rule: Read-only invariant applies — helpers must not write/delete anything
[RESTATE: No fs.writeFile, fs.unlink, fs.rm, spawn, or exec for deletion — registry query via execFile('reg', ['query', ...]) is the only permitted read-only exec]

## DELIVERABLE
Given registry has Local AppData for logged-in user, When resolveTemp() under elevation, Then returns C:\Users\<user>\AppData\Local\Temp
Given no registry entry, When resolveTemp(), Then falls back to %LOCALAPPDATA%\Temp
Given 0 bytes, When sizeHuman(0), Then "0 B"
Given 2.5 GB (1024), When sizeHuman(2.5*1024*1024*1024), Then "2.5 GB"
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Unit tests pass with `node --test`
  - sizeHuman uses 1024 base, 1 decimal, en locale, "0 B" exact
  - resolveTemp is read-only (no write operations)
Must-not-have:
  - No fs.writeFile, fs.unlink, fs.rm, spawn, exec (except read-only registry query)
  - No generic `utils.js` name — domain-scoped only
Open question risks:
  - Registry path for Local AppData may vary across Windows editions → fallback env covers
Red flags:
  - Any write/delete in helpers → STOP
Stop conditions:
  Done: tests green, no out-of-scope side effects
  Uncertain: registry lookup fails on target OS → NEEDS_CONTEXT
  Escalate: any write/delete detected

---

### Task 2: Backend server + recursive walk + /api/scan + start.bat [depends: T1]

## OBJECTIVE
Implement `server.js` (node:http) + `start.bat`:
- Serve `public/` static files (same-origin, path-traversal mitigation)
- `GET /api/scan`: recursive walk 5 whitelist folders; status per folder; `scannedAt`; `partial`
- `DELETE /api/scan` → 405; `POST /api/delete` → 404; unknown path → 404 (404 > 405)
- Bind `127.0.0.1:PORT`; startup failure messages (Node missing, port busy, default 3456)

Steps:
1. Write failing test for: `GET /api/scan returns 5 entries with ready status (happy path)`
   Test file: `tests/server.test.js`
   Level: integration (http + fs)
   Test intent: Given 5 whitelist folders exist and readable, When `GET /api/scan`, Then 5 entries with name/path/fileCount/sizeBytes/sizeHuman/status "ready" + scannedAt ISO-8601
   Exercise through: HTTP GET to running server on test port
   Test doubles: test port (env PORT), temp folders as fixtures, skip network
   Expected RED: server not implemented → connection refused / ENOENT
2. Run test — verify FAIL: `node --test tests/server.test.js`
3. Implement `server.js`: http server, recursive walk with `lstat` (no symlink follow), whitelist, status logic, schema, 404/405 → verify PASS → commit: `feat(server): /api/scan recursive whitelist walk`
4. Write failing test for: `POST /api/delete → 404, DELETE /api/scan → 405, DELETE /api/delete → 404 (404 wins)`
   Level: integration
   Exercise through: HTTP requests
   Expected RED: no routes → 404/500 for all
5. Run test — verify FAIL: `node --test tests/server.test.js`
6. Implement route matching (404 on unknown path, 405 on wrong method for known path) → verify PASS → commit: `feat(server): route rejection 404/405`
7. Write failing test for: `GET /api/scan when all folders access_denied → 200 + partial`
   Level: integration
   Test doubles: temp fixture with restricted ACL
   Expected RED: missing status logic → wrong schema or 500
8. Run test — verify FAIL: `node --test tests/server.test.js`
9. Implement access_denied/partial/not_found status logic + top-level partial flag → verify PASS → commit: `feat(server): folder status partial/not_found/access_denied`
10. Write failing test for: `GET /api/scan when scan exceeds 30s → partial: true`
    Level: integration
    Test doubles: mock walk delay > 30s (stub readdir to introduce delay)
    Expected RED: no timeout cap → hangs or wrong schema
11. Run test — verify FAIL: `node --test tests/server.test.js`
12. Implement 30s total walk cap → verify PASS → commit: `feat(server): 30s total scan cap`
13. Write failing test for: `server binds 127.0.0.1 only`
    Level: integration
    Test doubles: none (try connect from 0.0.0.0 socket)
    Expected RED: binds 0.0.0.0 → succeeds from any interface
14. Run test — verify FAIL: `node --test tests/server.test.js`
15. Implement bind 127.0.0.1 → verify PASS → commit: `feat(server): bind localhost only`
16. Create `start.bat`: check `where node`, check port availability, default `PORT=3456`, start server → commit: `feat(start): launcher with node/port checks`
17. Write failing test for: `start.bat prints clear error when port is busy`
    Level: integration
    Test doubles: occupy port, run bat
    Expected RED: no port check → silent bind or confusing error
18. Run test — verify FAIL: `node --test tests/startup.test.js`
19. Implement port check + node check in bat → verify PASS → commit: `fix(start): clear startup error messages`
20. Write failing test for: `start.bat prints clear error when Node.js not on PATH`
    Test file: `tests/startup.test.js`
    Level: integration
    Test intent: Given node not on PATH, When start.bat runs, Then clear "Node.js not found" message, no silent fail
    Exercise through: spawn start.bat, capture stdout
    Test doubles: temporarily hide node from PATH
    Expected RED: no node check → confusing error or silent fail
21. Run test — verify FAIL: `node --test tests/startup.test.js`
22. Implement node check in bat → verify PASS → commit: `fix(start): node missing message`
23. Write failing test for: `GET /api/scan with locked file → file skipped, folder stays ready`
    Test file: `tests/server.test.js`
    Level: integration
    Test intent: Given a file opened exclusively (locked), When GET /api/scan, Then file is skipped, folder status remains "ready", total size excludes locked file
    Exercise through: HTTP GET to server
    Test doubles: fixture with locked file via open handle
    Expected RED: locked file causes crash/500 or wrong status → test fails
24. Run test — verify FAIL: `node --test tests/server.test.js`
25. Implement locked-file skip (catch EPERM/EACCES, continue walk) → verify PASS → commit: `feat(server): locked file skip`
26. Write failing test for: `GET /api/scan with file vanished mid-walk (ENOENT) → skip, no crash`
    Test file: `tests/server.test.js`
    Level: integration
    Test intent: Given a file is deleted between readdir and stat (ENOENT), When GET /api/scan, Then file is skipped, walk continues, no crash, no HTTP 500
    Exercise through: HTTP GET to server
    Test doubles: stub readdir to return file that is deleted before stat
    Expected RED: ENOENT bubbles up → 500 or crash
27. Run test — verify FAIL: `node --test tests/server.test.js`
28. Implement ENOENT catch & continue → verify PASS → commit: `feat(server): ENOENT mid-walk skip`
29. Write failing test for: `GET /api/scan when skip count > 10% of fileCount → folder status partial`
    Test file: `tests/server.test.js`
    Level: integration
    Test intent: Given folder with 10 files, 2 locked (20% skip), When GET /api/scan, Then folder status "partial"
    Exercise through: HTTP GET to server
    Test doubles: fixture with locked files
    Expected RED: threshold logic missing → folder stays `ready`
30. Run test — verify FAIL: `node --test tests/server.test.js`
31. Implement 10% skip threshold → verify PASS → commit: `feat(server): partial threshold at 10% skip`
32. Write failing test for: `junction loop A→B→A inside temp → walk terminates, no infinite loop`
    Test file: `tests/server.test.js`
    Level: integration
    Test intent: Given a junction loop A→B→A, When GET /api/scan, Then walk terminates without infinite loop/OOM
    Exercise through: HTTP GET to server
    Test doubles: fixture with junction loop (requires admin; test skipped if not)
    Expected RED: walk hangs or OOM → timeout
33. Run test — verify FAIL: `node --test tests/server.test.js`
34. Implement visited-set on realpath (or skip junctions entirely via lstat) → verify PASS → commit: `feat(server): junction loop protection`
35. Write failing test for: `junction target size is NOT counted (no follow)`
    Test file: `tests/server.test.js`
    Level: integration
    Test intent: Given a junction pointing to D:\Projects\real-data with 1GB files, When GET /api/scan, Then sizeBytes does NOT include contents of D:\Projects\real-data
    Exercise through: HTTP GET to server
    Test doubles: fixture with junction to external folder
    Expected RED: walk follows junction via `stat` → sizeBytes includes external target
36. Run test — verify FAIL: `node --test tests/server.test.js`
37. Ensure walk uses `lstat` (not `stat`) and skips symlink/junction targets → verify PASS → commit: `feat(server): no junction follow`

## REFERENCES LOADED
`docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md` — all backend rules (R1-R7, R10-R12, route rejection, bind)

## WHY THIS APPROACH
Complexity: standard
Justification: Multi-file (server.js + start.bat) with branching status logic, timeout cap, and route matching. Straightforward node:http with clear spec — not deep.

## SANDWICH CONTEXT
[CRITICAL: Read-only invariant — no write/unlink/rm/spawn/exec in server.js or start.bat]
[CRITICAL: Whitelist-only scan (5 paths); lstat only — never follow symlink/junction]
[CRITICAL: Bind 127.0.0.1 only; frontend served from same process (same-origin)]
You are implementing backend for Cleanup Web Scanner.
Spec: docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md
Design decision: Option A — node:http core-only
Files in scope: server.js, start.bat, tests/server.test.js, tests/startup.test.js
Available after: T1 (lib/resolve-temp.js, lib/format.js)
Architecture rule: Read-only invariant applies throughout
[RESTATE: No fs.writeFile, fs.unlink, fs.rm, spawn, or exec — read-only walk only]

## DELIVERABLE
Given 5 folders readable, When GET /api/scan, Then 5 ready entries + scannedAt + partial=false
Given missing folder, When GET /api/scan, Then status not_found, 0, "0 B"
Given access_denied folder, When GET /api/scan, Then status access_denied + HTTP 200
Given all folders access_denied, When GET /api/scan, Then all access_denied, HTTP 200, empty-state copy ready
Given all folders not_found, When GET /api/scan, Then all not_found, HTTP 200, different empty-state
Given ≥1 partial entry, When GET /api/scan, Then top-level partial=true
Given 30s timeout exceeded, When GET /api/scan, Then partial=true + scannedAt set + unfinished=partial/0 + HTTP 200
Given DELETE /api/scan, When request, Then 405 {error:"..."}
Given POST /api/delete, When request, Then 404 {error:"..."}
Given DELETE /api/delete (unknown path + wrong method), When request, Then 404 wins
Given bind 127.0.0.1, When connect from LAN IP, Then connection refused
Given port 3456 busy, When start.bat, Then clear "Port 3456 in use" message, no silent fallback
Given node not on PATH, When start.bat, Then "Node.js not found" message
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All 14 server test scenarios pass
  - Recursive walk uses `lstat` (no symlink follow)
  - sizeHuman used from lib/format.js (not reimplemented)
  - resolveTemp used from lib/resolve-temp.js (not reimplemented)
  - JSON contract matches spec exactly
  - start.bat defaults PORT=3456, checks node/port, clear error messages
  - Console logs 1 line per failed folder (path + status + reason + elapsed ms), no stacktrace to API response
Must-not-have:
  - No fs.writeFile, fs.unlink, fs.rm, spawn, exec (except read-only registry via execFile in resolve-temp only)
  - No generic utils.js or inline helpers (use lib/format.js)
  - No auto-delete functionality
Open question risks:
  - 30s cap total vs per-folder: assumed total (spec) → if wrong: may prematurely mark folders partial
  - Resolve-temp registry path may vary → fallback env covers
Red flags:
  - Any write/delete in server.js or start.bat → STOP
  - Follows symlink via `stat` instead of `lstat` → STOP
  - Binds 0.0.0.0 or exposes to LAN → STOP
Stop conditions:
  Done: all server/startup tests green, no out-of-scope side effects
  Uncertain: walk performance on very large folders (100k+ files) → monitor, report if >10s
  Escalate: any write/delete/symlink-follow detected

---

### Task 3: Frontend (index.html + app.js) [depends: T1] [parallel: T2]

## OBJECTIVE
Implement `public/index.html` + `public/app.js`:
- Fetch `/api/scan` relative (same-origin), render per-folder summary
- Auto-scan once on page load
- Refresh button with loading state (disabled + "Memindai…")
- Race: requestId ordering; show result of last-SENT request
- Tab "Panduan Hapus Aman" (static prose)

Steps:
1. Write failing test for: `auto-scan on page load fetches /api/scan once`
   Test file: `tests/public.test.js`
   Level: unit (DOM + fetch stub)
   Test intent: Given page loads, When DOMContentLoaded fires, Then fetch('/api/scan') called exactly once
   Exercise through: app.js initialization logic
   Test doubles: fetch stub, DOM stub (jsdom)
   Expected RED: app.js not loaded → no fetch call
2. Run test — verify FAIL: `node --test tests/public.test.js`
3. Implement `public/index.html` + `public/app.js` (fetch, auto-scan, render) → verify PASS → commit: `feat(frontend): auto-scan and render folder summary`
4. Write failing test for: `Refresh disabled + label "Memindai…" during scan`
   Level: unit
   Test doubles: fake async fetch
   Expected RED: no loading state → button always enabled
5. Run test — verify FAIL: `node --test tests/public.test.js`
6. Implement loading state (button disabled + text swap) → verify PASS → commit: `feat(frontend): refresh loading state`
7. Write failing test for: `rapid Refresh shows result of last-SENT requestId`
   Level: unit
   Test doubles: fake fetch returning in reverse order
   Expected RED: shows last-completed instead of last-sent → wrong result displayed
8. Run test — verify FAIL: `node --test tests/public.test.js`
9. Implement requestId counter + comparator → verify PASS → commit: `feat(frontend): requestId ordering for race safety`
10. Write failing test for: `Tab Panduan renders safe-deletion guide prose`
    Level: unit
    Test doubles: DOM stub
    Expected RED: tab not implemented → empty content
11. Run test — verify FAIL: `node --test tests/public.test.js`
12. Implement guide tab (static prose: safe folders, steps, "don't touch" list, >14 day tip) → verify PASS → commit: `feat(frontend): safe-deletion guide tab`
13. Write failing test for: `empty-state copy differs for not_found vs access_denied`
    Level: unit
    Test doubles: mock scan responses
    Expected RED: same copy for both → wrong UX
14. Run test — verify FAIL: `node --test tests/public.test.js`
15. Implement distinct empty-state messages (access_denied → "Run as Administrator") → verify PASS → commit: `feat(frontend): distinct empty-state copy`
16. Write failing test for: `partial scan marks grand total as lower-bound`
    Test file: `tests/public.test.js`
    Level: unit
    Test intent: Given a scan response with `partial: true` and one partial entry, When UI renders totals, Then the grand total is marked as lower-bound (not exact)
    Exercise through: public render function / app state renderer
    Test doubles: mock scan response containing one `partial` entry and one `ready` entry
    Expected RED: renderer shows ordinary total with no lower-bound warning
17. Run test — verify FAIL: `node --test tests/public.test.js`
18. Implement lower-bound total marker/warning whenever response.partial is true → verify PASS → commit: `feat(frontend): mark partial totals as lower-bound`

## REFERENCES LOADED
`docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md` — R8 (auto-scan), R9 (refresh/loading), R11 (race/requestId), guide, empty-state, lower-bound totals

## WHY THIS APPROACH
Complexity: standard
Justification: Frontend has 5 distinct behavioral rules (auto-scan, loading state, race, guide, empty-state) each independently verifiable. jsdom for DOM tests in node:test.

## SANDWICH CONTEXT
[CRITICAL: No build step — vanilla HTML/JS only]
[CRITICAL: Fetch relative path /api/scan (same-origin, no hardcoded port)]
[CRITICAL: No exec/spawn in frontend; guide is static prose only]
You are implementing frontend for Cleanup Web Scanner.
Spec: docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md
Design decision: Option A — same-origin serve from backend
Files in scope: public/index.html, public/app.js, tests/public.test.js
Available after: T1 (JSON contract shape)
Architecture rule: Read-only invariant — no writes from frontend (fetch only)
[RESTATE: No exec/spawn; guide is static text; fetch must use relative path]

## DELIVERABLE
Given page load, When DOMContentLoaded, Then fetch('/api/scan') called once
Given scan in-flight, When user clicks Refresh, Then button disabled + label "Memindai…"
Given 3× Refresh in 1s, When responses return, Then UI shows last-SENT requestId result
Given tab Panduan, When clicked, Then static safe-deletion guide visible (no exec)
Given all folders access_denied, When render, Then copy says "Run as Administrator"
Given all folders not_found, When render, Then distinct copy (no admin hint)
Given ≥1 partial entry, When render, Then totals marked lower-bound
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All 5 frontend test scenarios pass
  - Fetch uses relative path (no hardcoded port)
  - Guide content: safe folders, steps, "don't touch" list, >14 day tip
  - No exec/spawn anywhere in public/
  - jsdom used for DOM tests (node:test compatible)
Must-not-have:
  - No build step, no bundler, no npm in public/
  - No "Open in Explorer" button (guide only)
  - No per-file age computation or per-file listing
  - No hardcoded port in fetch URL
Open question risks:
  - Manual DOM stub differences across Node versions → keep frontend behavior tests focused on exported pure render/state functions and use built-in `node:test` + `assert` only; no jsdom dependency
Red flags:
  - Any exec/spawn in app.js → STOP
  - Hardcoded 127.0.0.1:3456 in fetch → STOP
Stop conditions:
  Done: all frontend tests green, guide visible, no out-of-scope features
  Uncertain: jsdom availability in node:test → fall back to pure unit tests if needed
  Escalate: exec/spawn or hardcoded port detected

---

### Task 4: Read-only audit [depends: T2, T3]

## OBJECTIVE
Static analysis audit to confirm the entire codebase enforces read-only invariant:
- grep source files for `fs.writeFile`, `fs.unlink`, `fs.rm`, `child_process.spawn`, `child_process.exec`
- Verify only permitted exec: `execFile('reg', ['query', ...])` in resolve-temp.js
- Confirm no auto-delete affordance anywhere in frontend or backend

Steps:
1. Write test for: `codebase contains no write/delete operations`
   Test file: `tests/read-only.test.js`
   Level: integration (static analysis)
   Test intent: Given all source files, When grepping for forbidden patterns, Then zero matches outside allowed registry query
   Exercise through: `fs.readFileSync` + regex against source tree
   Test doubles: none
   Expected RED: grep finds forbidden pattern → test fails
2. Run test — verify FAIL: `node --test tests/read-only.test.js` (expected: passes if T2/T3 clean, but audit ensures ongoing invariant)
3. Implement audit script: read all `.js`/`.bat` files, regex-match forbidden patterns, assert zero matches (exception: `execFile('reg', ['query', ...])` in `lib/resolve-temp.js`) → commit: `test(audit): read-only invariant enforcement`
4. Run full test suite: `node --test tests/*.test.js` → all pass → commit: `chore(test): full suite green`

## REFERENCES LOADED
`docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md` — Read-only invariant (R2), architecture constraints

## WHY THIS APPROACH
Complexity: lightweight
Justification: Pure static analysis. Ensures the read-only invariant survives future edits. One test file, one grep, one assertion.

## SANDWICH CONTEXT
[CRITICAL: Read-only invariant must hold for entire codebase — this task is the final gate]
You are auditing Cleanup Web Scanner for read-only invariant.
Spec: docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md
Files in scope: all .js files + start.bat
Available after: T2, T3 (all source files exist)
Architecture rule: No fs.writeFile, fs.unlink, fs.rm, spawn, exec (except read-only registry query)

## DELIVERABLE
Given all source files, When audit runs, Then zero matches for forbidden patterns (except allowed registry query)
Given start.bat, When audit runs, Then no `del`, `rmdir /s`, `rd /s /q` commands found
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Audit test passes when codebase is clean
  - Audit test fails if forbidden pattern is introduced (regression guard)
  - Allowed exception documented: `execFile('reg', ['query', ...])` in resolve-temp.js only
Must-not-have:
  - Audit itself must not write/delete/create files (read-only analysis only)
Red flags:
  - Audit passes but forbidden pattern exists → STOP, fix audit regex
Stop conditions:
  Done: full test suite green, audit passes, no forbidden patterns
  Escalate: forbidden pattern found in source → STOP, do not proceed until removed

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Shared helpers + contract | prereq | lightweight | resolveTemp + sizeHuman unit tests green |
| T2 | Backend server + start.bat | T1 | standard | /api/scan all scenarios + startup checks green |
| T3 | Frontend (index.html + app.js) | T1 | standard | auto-scan, loading, race, guide, empty-state green |
| T4 | Read-only audit | T2, T3 | lightweight | grep audit passes + full suite green |
