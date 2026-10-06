# Task T1 — Shared helpers + contract shape

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
