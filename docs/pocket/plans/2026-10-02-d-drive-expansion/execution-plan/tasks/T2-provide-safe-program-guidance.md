# Task T2 — Provide safe program guidance

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 2: Provide safe program guidance [depends: T1]

## OBJECTIVE
Steps:
1. Write failing test in `tests/public.test.js`; unit/UI behavioral: Given D:\Program Files (group app) When guide opens Then user sees Windows Settings uninstall guidance and no delete/copy command for app entry; exercise actual guide rendering, not only static text; doubles: existing lightweight DOM fake or controlled source pattern (no new deps); expected RED: no dedicated app guide, generic delete instructions appear.
2. Run and verify RED: `node --test tests/public.test.js`.
3. Add app group labels, catalog entries and safe guide content in `public/app.js` and `public/index.html` as needed; ensure copy-command actions hidden/disabled for app; verify GREEN, run `npm test`, refactor while green; commit `feat(web): show uninstall-only guidance for program folders`.

## REFERENCES LOADED
Spec `docs/pocket/spec/2026-10-02-d-drive-expansion/d-drive-expansion-spec.md` — Rule 4; `public/app.js`, `public/index.html`, `tests/public.test.js`.

## WHY THIS APPROACH
Complexity: standard — app guide must not inherit generic destructive commands.

## SANDWICH CONTEXT
[CRITICAL: Program folders are observation-only; do not expose delete instructions for them.]
Implement UI guidance for app roots.
Spec: `docs/pocket/spec/2026-10-02-d-drive-expansion/d-drive-expansion-spec.md`.
Design decision: distinct app group, uninstall guidance.
Files in scope: `public/app.js`, `public/index.html`, `tests/public.test.js`.
Available after: T1.
Architecture rule: vanilla JS, no dependencies, no deletion operations.
[RESTATE: Program folders are observation-only; do not expose delete instructions for them.]

## DELIVERABLE
Given app folder When modal opens Then advise uninstall via Settings, with no deletion commands.
Given temp folder When modal opens Then existing temp guidance remains.

## QUALITY BAR
Must-have: both D:\Program and D:\Program Files use app guidance; tests green.
Must-not-have: deletion commands for app group, new dependencies or build step.
Open question risks: generic static guidance elsewhere may suggest manual deletion → inspect actual UI.

## STOP CONDITIONS
Done when: app UI behavior verified and full tests green.
Uncertain when: UI cannot distinguish group with current catalog.
Escalate when: destructive app command remains reachable.
