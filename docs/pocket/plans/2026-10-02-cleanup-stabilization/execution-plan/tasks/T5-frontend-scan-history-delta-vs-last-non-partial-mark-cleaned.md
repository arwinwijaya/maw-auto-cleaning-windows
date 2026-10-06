# Task T5 — Frontend — scan history, delta vs last non-partial, mark cleaned

**Phase:** 2
**Depends:** T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: Frontend — scan history, delta vs last non-partial, mark cleaned [depends: T4]

## OBJECTIVE
Give before/after feedback: store scan history (max 20, FIFO), show delta vs last non-partial scan, allow local "sudah dibersihkan" annotation.

Steps:
1. Write failing test for: History stores up to 20 scans [R7]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given 21 successful scans with incrementing totalBytes, When reading `localStorage` key `cleanupScanner.history.v1`, Then array length = 20 And the oldest entry corresponds to scan #2
   Exercise through: `loadApp` → repeated `renderScan`/scan cycles → inspect history key
   Test doubles: Mock fetch + localStorage; do NOT mock history helpers
   Expected RED: history key absent, or length 21 (no FIFO)
2. Run test — verify FAIL: `node --test tests/public.test.js`

3. Implement in `public/app.js` using the versioned storage keys from spec (R6):
   - A history load/save pair (try parse, default empty; push snapshot of scannedAt/totalBytes/partial/entries metadata, keep newest 20).
   - After a successful scan fetch, save a snapshot of the result.
   - Verify PASS for the R7 history test: `node --test tests/public.test.js`

4. Write failing test for: Delta displayed vs last non-partial scan [R8]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given history has a non-partial baseline totalBytes 2500000000 and current scan totalBytes 1100000000, When `renderScan` renders, Then UI shows delta text containing "Turun" And a human size (~1,4 GB) And the relative time of the baseline
   Exercise through: `loadApp` → seed history in localStorage → `renderScan` → inspect delta DOM element
   Test doubles: Mock fetch + localStorage + `Date.now` for relative time
   Expected RED: delta text absent
5. Run test — verify FAIL: `node --test tests/public.test.js`

6. Implement a delta-baseline helper (walk history backwards for the first non-partial entry before the current) and render the delta unconditionally into a new delta element. **Intermediate state:** when no valid baseline exists, render the delta element anyway with a zero-drop placeholder ("Turun" plus zero size); this deliberately leaves the empty-baseline case unguarded so the R9 cycle can fail RED. Verify PASS for the seeded-baseline case from step 4 (run that test by name).

7. Write failing test for: Partial scans excluded from delta baseline [R8 edge]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given history: scan1 (partial, 1.1GB), scan2 (ready, 2.5GB), scan3 (ready, 1.0GB), When scan3 renders, Then delta computed vs scan2 → "Turun 1,5 GB sejak <scan2 time>"
   Exercise through: seed history → renderScan → inspect delta
   Test doubles: Mock fetch + localStorage + Date.now
   Expected RED: delta computed vs scan1 (partial) or absent
8. Run test — verify FAIL: `node --test tests/public.test.js`
9. Implement the partial-skip in the delta-baseline helper, verify PASS.

10. Write failing test for: No delta on first scan [R9]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given empty history, When first scan completes, Then UI shows only "Terakhir dipindai" And no delta text
   Exercise through: `loadApp` with empty store → renderScan → inspect
   Test doubles: Mock fetch + localStorage
   Expected RED: delta element still renders the zero-drop placeholder because step 6 renders unconditionally
11. Run test — verify FAIL: `node --test tests/public.test.js`; add the empty-baseline guard (only render delta when a valid non-self, non-partial baseline with strictly larger totalBytes exists), verify PASS.

12. Write failing test for: Mark cleaned stores timestamp [R10]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given a completed scan, When user clicks the cleaned button, Then the versioned last-cleaned key in localStorage is set to an ISO time
   Exercise through: `loadApp` → renderScan → click the mark-cleaned control → inspect localStorage
   Test doubles: Mock fetch + localStorage + Date
   Expected RED: key not set
13. Run test — verify FAIL: `node --test tests/public.test.js`; implement button + listener (add the control to `public/index.html`), verify PASS.

14. Write failing test for: Cleaned timestamp displayed [R11]
    Test file: `tests/public.test.js`
    Level: unit
    Test intent: Given a stored last-cleaned time = 2 hours ago, When page loaded, Then UI shows "Terakhir dibersihkan: 2 jam lalu"
    Exercise through: seed localStorage → `loadApp` → inspect display
    Test doubles: Mock fetch + localStorage + Date
    Expected RED: cleaned text absent
15. Run test — verify FAIL; implement relative-time display, verify PASS.

16. Write failing test for: Cleaned timestamp never affects scan or delta [R10 edge]
    Test file: `tests/public.test.js`
    Level: unit
    Test intent: Given a stored last-cleaned time exists And seeded history with a non-partial baseline, When a new scan runs and renders, Then scan totals are independent of the cleaned time And delta is computed vs the previous scan baseline (not vs last-cleaned time)
    Exercise through: seed localStorage → `loadApp` → renderScan → inspect totals + delta
    Test doubles: Mock fetch + localStorage + Date
    Expected RED: delta incorrectly based on the cleaned time, or scan totals affected
17. Run test — verify FAIL; enforce independence (history/delta never read the cleaned key), verify PASS; refactor while green, commit: `git commit -m "feat(web): scan history, delta, and mark cleaned"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rules R7, R8, R9, R10, R11 (Stories 4+5), findings B2, N2, N6.
public/app.js:791-935 (`renderScan`, `scan`, `init`, `els`).
lib/format.js — `sizeHuman` (reuse).
tests/public.test.js — loadApp + localStorage mock from T4.

## WHY THIS APPROACH
Complexity: standard
Justification: localStorage state machine (FIFO, baseline walk) + UI; multiple GWT but cohesive storage area; needs relative-time formatting.

## SANDWICH CONTEXT
[CRITICAL: public/ must never contain forbidden patterns; history is localStorage-only, never sent to server.]
You are implementing T5 history/delta/cleaned for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — localStorage v1, 20 FIFO, delta vs last non-partial, cleaned is local annotation.
Files in scope: public/app.js, public/index.html, tests/public.test.js.
Available after: T4
Architecture rule: No API change for history; additive localStorage keys only.
[RESTATE: History is localStorage-only, never sent to server; never add forbidden patterns.]

## DELIVERABLE
Given 21 scans, Then history length 20, oldest dropped
Given last non-partial 2.5GB, current 1.1GB, Then "Turun 1,4 GB sejak <time>"
Given history scan1 partial, Then delta vs scan2 not scan1
Given empty history, Then only "Terakhir dipindai"
Given scan done + click "✓ Sudah dibersihkan", Then lastCleanedAt set And "Terakhir dibersihkan: 2 jam lalu" And scan unaffected
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - History 20 FIFO after 21 saves
  - Delta vs last non-partial (partial skipped)
  - No delta on first scan
  - Mark cleaned saves ISO string + displays relative time
  - Mark cleaned never affects scan/delta
  - try/catch on JSON parse

Must-not-have:
  - Sending history to server
  - Using a partial entry as delta baseline

Open question risks:
  - History 20 assumed enough

Rollback note:
  - Revert commit; keys orphaned but harmless

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Mocking history helper instead of exercising via renderScan → STOP

## STOP CONDITIONS
Done when: history FIFO, delta non-partial, no-delta-first, mark cleaned GWT pass.
Uncertain when: relative time formatting ambiguous → NEEDS_CONTEXT.
Escalate when: asset guard fails.
