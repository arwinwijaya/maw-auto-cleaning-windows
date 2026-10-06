# Task T2 — Backend server + recursive walk + /api/scan + start.bat

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
