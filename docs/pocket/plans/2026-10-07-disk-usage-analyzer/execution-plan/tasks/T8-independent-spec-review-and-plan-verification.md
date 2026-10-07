# Task T8 — Independent spec review and plan verification

**Phase:** 2
**Depends:** T2, T3, T4, T5, T6, T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
