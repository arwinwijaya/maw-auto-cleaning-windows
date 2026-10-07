# Task T2 — Audit concurrency helper mapLimit

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
