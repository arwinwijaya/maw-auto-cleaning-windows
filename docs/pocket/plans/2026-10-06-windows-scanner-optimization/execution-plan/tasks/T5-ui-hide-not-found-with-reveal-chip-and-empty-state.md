# Task T5 — UI hide not_found with reveal chip and empty state

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: UI hide not_found with reveal chip and empty state [prereq]

## OBJECTIVE
Hide `not_found` entries by default in the results render, add a reveal chip, and show an empty state when all entries are `not_found` — never hiding `access_denied`/`partial`.

Steps:
1. Write failing test for: not_found hidden by default + chip
   Test file: `tests/public.test.js`
   Level: integration (vm harness rendering `public/app.js`)
   Test intent: Given a scan payload of 18 entries including 4 with status `not_found`, When results render with default preferences, Then 14 entries are visible in the grouped list, a chip reading "4 folder disembunyikan (tidak ditemukan)" is shown, and no `not_found` badge appears in the visible list.
   Exercise through: `loadApp`/render entrypoint used by existing public tests
   Test doubles: existing fake DOM + fetch harness
   Expected RED: current render shows all 18 entries (no `hideNotFound` filter exists).
2. Run test — verify FAIL: `node --test tests/public.test.js`
3. Write failing test for: chip click reveals hidden not_found
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given the chip "4 folder disembunyikan (tidak ditemukan)" is visible, When the user clicks the chip, Then all 18 entries are visible, the 4 entries show status badge "Tidak ditemukan", and the chip disappears.
   Exercise through: same render entrypoint
   Test doubles: existing fake DOM
   Expected RED: clicking current chip toggles `prefs.hideZero`, not the new `prefs.hideNotFound` filter.
4. Run test — verify FAIL: `node --test tests/public.test.js`
5. Write failing test for: access_denied and partial are never hidden
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given 2 `not_found`, 1 `access_denied`, 1 `partial` entries, When results render with default filter, Then only the 2 `not_found` are hidden and the `access_denied` and `partial` entries remain visible with their reason badges.
   Exercise through: same render entrypoint
   Test doubles: existing fake DOM
   Expected RED: no status filter logic exists; all 4 entries render as cards.
6. Run test — verify FAIL: `node --test tests/public.test.js`
7. Write failing test for: empty state when all entries are not_found
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given `hideNotFound` is true and all scanned folders return `not_found`, When results render, Then an empty state message is displayed alongside the reveal chip (chip shows total count).
   Exercise through: same render entrypoint
   Test doubles: existing fake DOM
   Expected RED: current code renders generic "Belum ada data untuk ditampilkan" when `rendered === 0` instead of pairing the empty state container with the reveal chip.
8. Run test — verify FAIL: `node --test tests/public.test.js`
9. Implement in `public/app.js`: add `hideNotFound` preference (default true, persisted in localStorage), filter `status === 'not_found'` in `renderScan`, render the reveal chip for `not_found` count, and handle the all-not_found empty state. Preserve existing `hideZero` behavior.
10. Refactor while green; commit: `feat(web): hide not_found folders behind reveal chip`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 1 rules 1.1–1.3

## WHY THIS APPROACH
Complexity: standard
Justification: Render + prefs + accessibility text in one UI module; must not regress existing hide-zero/prefs tests.

## SANDWICH CONTEXT
[CRITICAL: `access_denied` and `partial` entries must NEVER be hidden by any filter]
You are adding the missing-folder filter to the UI.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — hide `not_found` with reveal chip.
Files in scope: `public/app.js`, `tests/public.test.js`
Available after: none (prereq)
Architecture rule: follow existing prefs/localStorage + `createEl` render patterns; vanilla JS only.
[RESTATE: only `not_found` is filterable; `access_denied`/`partial` stay visible]

## DELIVERABLE
Given 4 `not_found` of 18, When rendered, Then 14 visible + chip "4 folder disembunyikan (tidak ditemukan)".
Given the chip is clicked, Then all entries are visible.
Given `access_denied`/`partial`, Then they are always visible.
Given all entries `not_found`, Then an empty state renders with the chip.
[must-not] Given `partial` or `access_denied`, When the filter is on, Then the entry must NOT be hidden.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - Chip has accessible label (aria)
  - Existing hide-zero + prefs tests stay green
  - Conventional commit
Must-not-have:
  - Hiding `access_denied`/`partial`
  - Changing scan-fetch/race (`requestId`) logic
Open question risks:
  - Whether the chip also appears when count is 0 → assumed hidden when 0
Rollback note:
  - Remove the filter; all entries render as before.
Red flags:
  - access_denied/partial hidden → STOP
  - Existing prefs test breaks → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: filter/chip/empty-state scenarios pass; existing public tests green
Uncertain when: chip visibility rules disputed
Escalate when: never-hide invariant violated
