# Task T2 — Backend — partial reason field on scan entries

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
