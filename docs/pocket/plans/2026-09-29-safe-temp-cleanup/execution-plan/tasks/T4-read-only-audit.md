# Task T4 — Read-only audit

**Phase:** 1
**Depends:** T2, T3
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
