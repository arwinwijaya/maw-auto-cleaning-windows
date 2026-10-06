# Task T1 — Bounded concurrency helper module

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 1: Bounded concurrency helper module [prereq]

## OBJECTIVE
Create a zero-dependency bounded-concurrency map helper used by the scan walker.

Steps:
1. Write failing test for: bounded concurrency + order preservation
   Test file: `tests/concurrency.test.js`
   Level: unit
   Test intent: Given an array of 20 items and limit 4, When `mapLimit` runs an async mapper, Then the number of simultaneously in-flight mapper calls never exceeds 4, and results preserve input order.
   Exercise through: exported `mapLimit(items, limit, mapper)` public function
   Test doubles: instrument the mapper with a counter (no fs, no timers beyond resolved promises)
   Expected RED: `lib/concurrency.js` does not exist yet → import fails / function undefined.
2. Run test — verify FAIL: `node --test tests/concurrency.test.js`
3. Write failing test for: edge cases
   Test file: `tests/concurrency.test.js`
   Level: unit
   Test intent: Given an empty array, When `mapLimit` runs, Then it resolves `[]`; Given `limit` greater than item count, Then all items run; Given a mapper that rejects on one item, Then the returned promise rejects and no unhandled rejection escapes.
   Exercise through: same exported `mapLimit`
   Test doubles: none
   Expected RED: same missing module.
4. Run test — verify FAIL: `node --test tests/concurrency.test.js`
5. Implement `lib/concurrency.js` (cursor-based worker pool, `'use strict'`, CommonJS `module.exports = { mapLimit }`) until both cycles pass.
6. Refactor while green; commit: `feat(lib): add zero-dependency bounded concurrency helper`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 4: "Concurrency reduces wall-time without changing semantics"

## WHY THIS APPROACH
Complexity: lightweight
Justification: Single small module, clear contract, no cross-file judgment.

## SANDWICH CONTEXT
[CRITICAL: Zero new dependencies — Node builtins + vanilla JS only]
You are implementing a reusable concurrency helper for the Windows scanner optimization.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — custom zero-dependency bounded concurrency pool.
Files in scope: `lib/concurrency.js` (create), `tests/concurrency.test.js` (create)
Available after: none (prereq)
Architecture rule: follow existing CommonJS module conventions (`'use strict'`, `module.exports` object).
[RESTATE: Zero new dependencies — do not add p-limit or any npm package]

## DELIVERABLE
Given 20 items and limit 4, When `mapLimit` runs, Then max in-flight ≤ 4 and order preserved.
Given an empty array, When `mapLimit` runs, Then it resolves `[]`.
[must-not] Given any input, When `mapLimit` runs, Then it must NOT add an external dependency.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - `mapLimit` exported and independently unit-testable
  - Conventional commit message
Must-not-have:
  - Any npm dependency
  - Generic `utils.js` naming (module is domain-scoped: concurrency)
Open question risks:
  - None
Rollback note:
  - Delete `lib/concurrency.js`; no other file imports it until T2.
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Dependency added → STOP

## STOP CONDITIONS
Done when: both RED cycles pass, no out-of-scope files modified
Uncertain when: limit semantics ambiguous
Escalate when: constraint violated
