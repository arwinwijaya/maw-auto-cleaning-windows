# Task T6 — UI fallback exemption badge

**Phase:** 2
**Depends:** T3, T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: UI fallback exemption badge [depends: T3, T5]

## OBJECTIVE
Keep fallback entries (profile resolution failed) visible even when `hideNotFound` is on, with a warning badge.

Steps:
1. Write failing test for: fallback entry stays visible with warning
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given an entry with `fallback: true` and status `not_found`, When results render with `hideNotFound` on, Then that entry is visible with a warning badge ("Fallback — resolusi profil gagal") and is omitted from the hidden count.
   Exercise through: render entrypoint
   Test doubles: existing fake DOM + fetch harness
   Expected RED: T5's `status === 'not_found'` filter hides all `not_found` entries including `fallback: true` entries.
2. Run test — verify FAIL: `node --test tests/public.test.js`
3. Write failing test for: hidden count excludes fallback entries
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given 3 `not_found` entries where 1 has `fallback: true`, When results render with filter on, Then the chip reads "2 folder disembunyikan (tidak ditemukan)".
   Exercise through: render entrypoint
   Test doubles: existing fake DOM
   Expected RED: T5's chip count includes all `not_found` entries regardless of `fallback`.
4. Run test — verify FAIL: `node --test tests/public.test.js`
5. Implement in `public/app.js`: exempt `entry.fallback === true` from the `not_found` filter, render a warning badge on fallback cards, and exclude fallback entries from the hidden count calculation.
6. Run test — verify PASS: `node --test tests/public.test.js`
7. Refactor while green; commit: `feat(web): keep fallback entries visible with warning badge`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 1 "Fallback missing path is exempt from hiding"

## WHY THIS APPROACH
Complexity: lightweight
Justification: One conditional branch + badge in an existing render path.

## SANDWICH CONTEXT
[CRITICAL: only `not_found` non-fallback entries are hidden]
You are adding the fallback exemption to the results render.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — fallback exemption.
Files in scope: `public/app.js`, `tests/public.test.js`
Available after: T3 (`fallback` marker), T5 (filter exists)
Architecture rule: consume the `fallback` field from the scan payload; vanilla JS only.
[RESTATE: fallback entries remain visible with a warning badge]

## DELIVERABLE
Given `fallback: true` + `not_found`, When rendered with the filter on, Then the entry is visible with a warning badge.
Given fallback entries exist, Then the hidden count excludes them.
[must-not] Given a non-fallback `not_found`, When rendered, Then it must still be hidden.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - Warning badge accessible label
  - Conventional commit
Must-not-have:
  - Exempting non-fallback entries
Open question risks:
  - Badge copy wording → assumed "Fallback — resolusi profil gagal"
Rollback note:
  - Remove the exemption; fallback entries hide like other `not_found`.
Red flags:
  - Non-fallback entries exempted → STOP

## STOP CONDITIONS
Done when: fallback exemption scenario passes; T5 tests still green
Uncertain when: badge copy disputed
Escalate when: filter invariant broken
