# Task T6 — Audit frontend UI behaviors

**Phase:** 2
**Depends:** T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: Audit frontend UI behaviors [depends: T5]

## OBJECTIVE
Verify `public/app.js` and `public/index.html` against UI GWT scenarios using `tests/ui-regression.test.js`.

Steps:
1. Audit existing tests in `tests/ui-regression.test.js` (7 tests via `node:vm` DOM stub):
   - `sortRows orders by size desc by default`
   - `sortRows supports all sort modes`
   - `renderTree produces expand indicator and guidance link`
   - `renderTree expands/collapses children via state.expanded`
   - `renderGuide renders copy buttons and commands`
   - `matchesFilter filters by path and min size`
   - `live refresh preserves expanded nodes and updates children`
2. Verify CSS in `public/index.html`: `.guide-link` uses `var(--brand)` for border/color and hover inverts.
3. Verify the copy-only GWT in `public/app.js` lines 583–592: click handlers on `.copy-btn` call `navigator.clipboard.writeText(command)` and show a toast; no process is spawned. The existing test `frontend: renderGuide renders copy buttons and commands` covers DOM rendering; the handler logic is static and auditable.
4. Run UI regression tests:
   `node --test tests/ui-regression.test.js`
5. Verify all 7 tests pass.
6. Commit verification status: `test(ui): audit frontend UI behaviors against baseline`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rules: Progressive and explorable results; Path classification and manual guidance

## WHY THIS APPROACH
Complexity: standard
Justification: 7 UI regression tests cover sort/filter, tree expansion, live refresh, guide rendering, and brand styling using zero-dependency `node:vm` stub.

## SANDWICH CONTEXT
[CRITICAL: UI uses server-issued opaque IDs; no client paths on wire; zero frontend dependencies; Indonesian blue/purple theme uses --brand: #2563eb / --brand-2: #7c3aed.]
You are auditing frontend UI verification.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: WinDirStat-style tree + treemap + guides, vanilla JS, no build step.
Files in scope: public/app.js, public/index.html, tests/ui-regression.test.js
Available after: T5
Architecture rule: Zero frontend dependencies; all navigation via opaque IDs.
[RESTATE: UI uses server-issued opaque IDs; no client paths on wire; zero frontend dependencies; Indonesian blue/purple theme uses --brand: #2563eb / --brand-2: #7c3aed.]

## DELIVERABLE
Given sort/filter controls, When applied, Then displayed rows follow selected mode.
Given expanded node set, When live refresh runs, Then expanded set is preserved.
Given guide-link button, When rendered, Then styled with var(--brand).

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - All 7 tests in `tests/ui-regression.test.js` pass

Must-not-have:
  - jsdom or DOM dependencies
  - Client paths on wire

## STOP CONDITIONS
Done when: DELIVERABLE verified and UI tests pass
Escalate when: constraint violated
