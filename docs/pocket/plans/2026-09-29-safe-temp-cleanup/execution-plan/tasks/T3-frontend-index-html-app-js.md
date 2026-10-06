# Task T3 — Frontend (index.html + app.js)

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: Frontend (index.html + app.js) [depends: T1] [parallel: T2]

## OBJECTIVE
Implement `public/index.html` + `public/app.js`:
- Fetch `/api/scan` relative (same-origin), render per-folder summary
- Auto-scan once on page load
- Refresh button with loading state (disabled + "Memindai…")
- Race: requestId ordering; show result of last-SENT request
- Tab "Panduan Hapus Aman" (static prose)

Steps:
1. Write failing test for: `auto-scan on page load fetches /api/scan once`
   Test file: `tests/public.test.js`
   Level: unit (DOM + fetch stub)
   Test intent: Given page loads, When DOMContentLoaded fires, Then fetch('/api/scan') called exactly once
   Exercise through: app.js initialization logic
   Test doubles: fetch stub, DOM stub (jsdom)
   Expected RED: app.js not loaded → no fetch call
2. Run test — verify FAIL: `node --test tests/public.test.js`
3. Implement `public/index.html` + `public/app.js` (fetch, auto-scan, render) → verify PASS → commit: `feat(frontend): auto-scan and render folder summary`
4. Write failing test for: `Refresh disabled + label "Memindai…" during scan`
   Level: unit
   Test doubles: fake async fetch
   Expected RED: no loading state → button always enabled
5. Run test — verify FAIL: `node --test tests/public.test.js`
6. Implement loading state (button disabled + text swap) → verify PASS → commit: `feat(frontend): refresh loading state`
7. Write failing test for: `rapid Refresh shows result of last-SENT requestId`
   Level: unit
   Test doubles: fake fetch returning in reverse order
   Expected RED: shows last-completed instead of last-sent → wrong result displayed
8. Run test — verify FAIL: `node --test tests/public.test.js`
9. Implement requestId counter + comparator → verify PASS → commit: `feat(frontend): requestId ordering for race safety`
10. Write failing test for: `Tab Panduan renders safe-deletion guide prose`
    Level: unit
    Test doubles: DOM stub
    Expected RED: tab not implemented → empty content
11. Run test — verify FAIL: `node --test tests/public.test.js`
12. Implement guide tab (static prose: safe folders, steps, "don't touch" list, >14 day tip) → verify PASS → commit: `feat(frontend): safe-deletion guide tab`
13. Write failing test for: `empty-state copy differs for not_found vs access_denied`
    Level: unit
    Test doubles: mock scan responses
    Expected RED: same copy for both → wrong UX
14. Run test — verify FAIL: `node --test tests/public.test.js`
15. Implement distinct empty-state messages (access_denied → "Run as Administrator") → verify PASS → commit: `feat(frontend): distinct empty-state copy`
16. Write failing test for: `partial scan marks grand total as lower-bound`
    Test file: `tests/public.test.js`
    Level: unit
    Test intent: Given a scan response with `partial: true` and one partial entry, When UI renders totals, Then the grand total is marked as lower-bound (not exact)
    Exercise through: public render function / app state renderer
    Test doubles: mock scan response containing one `partial` entry and one `ready` entry
    Expected RED: renderer shows ordinary total with no lower-bound warning
17. Run test — verify FAIL: `node --test tests/public.test.js`
18. Implement lower-bound total marker/warning whenever response.partial is true → verify PASS → commit: `feat(frontend): mark partial totals as lower-bound`

## REFERENCES LOADED
`docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md` — R8 (auto-scan), R9 (refresh/loading), R11 (race/requestId), guide, empty-state, lower-bound totals

## WHY THIS APPROACH
Complexity: standard
Justification: Frontend has 5 distinct behavioral rules (auto-scan, loading state, race, guide, empty-state) each independently verifiable. jsdom for DOM tests in node:test.

## SANDWICH CONTEXT
[CRITICAL: No build step — vanilla HTML/JS only]
[CRITICAL: Fetch relative path /api/scan (same-origin, no hardcoded port)]
[CRITICAL: No exec/spawn in frontend; guide is static prose only]
You are implementing frontend for Cleanup Web Scanner.
Spec: docs/pocket/spec/2026-09-29-safe-temp-cleanup/cleanup-web-scanner.md
Design decision: Option A — same-origin serve from backend
Files in scope: public/index.html, public/app.js, tests/public.test.js
Available after: T1 (JSON contract shape)
Architecture rule: Read-only invariant — no writes from frontend (fetch only)
[RESTATE: No exec/spawn; guide is static text; fetch must use relative path]

## DELIVERABLE
Given page load, When DOMContentLoaded, Then fetch('/api/scan') called once
Given scan in-flight, When user clicks Refresh, Then button disabled + label "Memindai…"
Given 3× Refresh in 1s, When responses return, Then UI shows last-SENT requestId result
Given tab Panduan, When clicked, Then static safe-deletion guide visible (no exec)
Given all folders access_denied, When render, Then copy says "Run as Administrator"
Given all folders not_found, When render, Then distinct copy (no admin hint)
Given ≥1 partial entry, When render, Then totals marked lower-bound
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All 5 frontend test scenarios pass
  - Fetch uses relative path (no hardcoded port)
  - Guide content: safe folders, steps, "don't touch" list, >14 day tip
  - No exec/spawn anywhere in public/
  - jsdom used for DOM tests (node:test compatible)
Must-not-have:
  - No build step, no bundler, no npm in public/
  - No "Open in Explorer" button (guide only)
  - No per-file age computation or per-file listing
  - No hardcoded port in fetch URL
Open question risks:
  - Manual DOM stub differences across Node versions → keep frontend behavior tests focused on exported pure render/state functions and use built-in `node:test` + `assert` only; no jsdom dependency
Red flags:
  - Any exec/spawn in app.js → STOP
  - Hardcoded 127.0.0.1:3456 in fetch → STOP
Stop conditions:
  Done: all frontend tests green, guide visible, no out-of-scope features
  Uncertain: jsdom availability in node:test → fall back to pure unit tests if needed
  Escalate: exec/spawn or hardcoded port detected
