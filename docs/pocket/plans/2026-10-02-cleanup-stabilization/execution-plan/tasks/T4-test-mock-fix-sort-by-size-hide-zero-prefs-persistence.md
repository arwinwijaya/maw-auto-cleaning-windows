# Task T4 — Test mock fix + sort by size + hide-zero + prefs persistence

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 4: Test mock fix + sort by size + hide-zero + prefs persistence [depends: T1]

## OBJECTIVE
First unblock the vm test harness (localStorage mock), then make 15-card scan results scannable: sort descending by size within each group, hide zero-byte folders, persist prefs.

Steps:
1. **Mock prerequisite (B1 fix):** Add a Map-backed `localStorage` mock to `tests/public.test.js` `loadApp()` and inject it as both global `localStorage` and `window.localStorage` in the vm context. Mock must implement `getItem`, `setItem`, `removeItem`, `clear`, `key(i)`, and a `length` accessor. Accept an optional injected store so two `loadApp` calls can share state (needed by R6). This step is a structural enabler with no behavioral GWT of its own; verify it does not break existing scenarios: `node --test tests/public.test.js` stays green.
2. Write failing test for: Cards sorted by size descending within group [R4]
   Test file: `tests/public.test.js`
   Level: unit (vm context)
   Test intent: Given scan payload with Temp group: `Local\Temp` sizeBytes 2362232012 and `Windows\Temp` sizeBytes 741376, When `renderScan` renders, Then the first card in the Temp group's DOM is `Local\Temp` And second is `Windows\Temp`
   Exercise through: `loadApp` vm context → `window.cleanupScanner.renderScan(payload)` → inspect `document.getElementById('results-content')` children
   Test doubles: Mock `fetch` (payload) and `localStorage` (from step 1); do NOT mock `renderScan`/`renderCard`
   Expected RED: cards in payload insertion order (unsorted)
3. Run test — verify FAIL: `node --test tests/public.test.js`

4. Implement in `public/app.js` **sort only, in-memory prefs (no persistence yet)**:
   - Add an in-memory prefs object on app state with sort-descending default ON and hide-zero default OFF (values per spec, no literal key names).
   - In `renderScan(data)`: sort each group's entries by `sizeBytes` descending when sort-descending is on (stable tie-break by original index).
   - In `public/index.html`: add a sort-descending control (checked by default) in the results tab. Wire its listener to mutate prefs and re-render from the last scan data.
   - `init()` reflects the control state from prefs.
   - Verify PASS for the R4 sort test: `node --test tests/public.test.js`

5. Write failing test for: Hide zero folders toggles visibility + chip restore [R5]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given payload with 12 zero-byte folders and 3 non-zero, When user clicks hideZero toggle ON, Then zero folders absent from DOM And chip shows "12 folder kosong disembunyikan" And clicking chip restores them
   Exercise through: `loadApp` → `renderScan` → dispatch click on toggle → inspect DOM
   Test doubles: Mock fetch + localStorage (step 1)
   Expected RED: zero folders still visible, chip absent (only sort implemented in step 4)
6. Run test — verify FAIL: `node --test tests/public.test.js`

7. Implement hide-zero filter + chip: add a hide-zero control (unchecked by default) and a hidden-count chip container in the results tab; when hide-zero is on, omit zero-byte/zero-file entries from the DOM while keeping them in the total; chip shows hidden count and restores on click. Verify PASS for R5.

8. Write failing test for: Preferences persist across reload [R6]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given user toggled hideZero ON and sort OFF (shared store), When a second `loadApp` runs with the same localStorage store, Then hideZero still ON And sort still OFF
   Exercise through: two `loadApp` calls sharing the store → inspect prefs/DOM
   Test doubles: Shared localStorage Map across two loads
   Expected RED: prefs reset to defaults on reload (no persistence implemented yet)
9. Run test — verify FAIL: `node --test tests/public.test.js`

10. Implement persistence in `public/app.js` using the versioned prefs key from spec (R6): a load function (try/catch around JSON parse, defaults per spec) and a save function (try/catch around setItem); `init()` loads prefs and toggle listeners save them. Verify PASS for R6.
11. Refactor while green, commit: `git commit -m "feat(web): sort by size, hide-zero toggle, prefs persistence"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rules R4, R5, R6 (Stories 2+3), blocking finding B1.
public/app.js:748-870 (`renderCard`, `renderScan`, GROUP_ORDER, GROUP_LABELS).
public/index.html:481-495 (results tab structure).
tests/public.test.js:95-180 (`loadApp`, `makeDocument`, vm context).

## WHY THIS APPROACH
Complexity: standard
Justification: Cross-cutting: mock fix + two features + persistence. Logic isolated to prefs + sort/filter; requires DOM inspection in tests.

## SANDWICH CONTEXT
[CRITICAL: public/ must never contain child_process/spawn/exec/execFile or hardcoded host:port.]
You are implementing T4 sort/hide/prefs for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — localStorage `cleanupScanner.prefs.v1`, sort desc ON default, hideZero OFF default.
Files in scope: public/app.js, public/index.html, tests/public.test.js.
Available after: T1
Architecture rule: Zero deps; prefs key versioned v1; try/catch around JSON parse.
[RESTATE: public/ must never contain forbidden patterns or hardcoded host:port.]

## DELIVERABLE
Given Local\Temp 2.2GB, Windows\Temp 724KB, When render, Then Local\Temp first
Given 12 zero folders, When toggle ON, Then hidden, chip "12 folder kosong disembunyikan", chip restores
Given toggles set, When reload (shared store), Then state restored
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - localStorage mock in loadApp (Map-backed, full API, injectable store)
  - Sort desc within group + stable tie-break
  - Hide-zero filter + chip + restore
  - Prefs persistence via cleanupScanner.prefs.v1 with try/catch
  - All existing public.test.js scenarios still pass

Must-not-have:
  - Hardcoded host:port in public files
  - exec/spawn patterns

Open question risks:
  - Sort default desc ON assumed

Rollback note:
  - Revert commit; controls disappear, key orphaned (harmless)

Red flags:
  - Mocking renderScan itself → STOP
  - Modifying server.js → out of scope

## STOP CONDITIONS
Done when: sorting, hide-zero, persistence GWT pass, `node --test tests/public.test.js` green.
Uncertain when: localStorage quota edge → NEEDS_CONTEXT.
Escalate when: asset guard fails.
