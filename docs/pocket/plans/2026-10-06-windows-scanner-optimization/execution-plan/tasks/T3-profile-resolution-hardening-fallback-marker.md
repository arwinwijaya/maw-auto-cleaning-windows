# Task T3 — Profile resolution hardening + fallback marker

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
