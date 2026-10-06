# Task T7 — Favicon + partial reason badge + regression verification

**Phase:** 2
**Depends:** T2, T3, T6
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 7: Favicon + partial reason badge + regression verification [depends: T2, T3, T6]

## OBJECTIVE
Serve a favicon, surface the partial `reason` in the folder modal, and run explicit regression verification for the read-only invariant and asset guard (R19, R20).

Steps:
1. Write failing test for: Favicon served correctly [R12]
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given `public/favicon.svg` exists, When GET /favicon.svg, Then status 200 And content-type image/svg+xml And CSP header present
   Exercise through: `createServer` + fetch `/favicon.svg` (serveStatic path)
   Test doubles: None
   Expected RED: 404 (file does not exist yet)
2. Run test — verify FAIL: `node --test tests/server.test.js`

3. Implement:
   - Create `public/favicon.svg` — a minimal 32×32 SVG placeholder (no forbidden substrings).
   - Add `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` in `public/index.html` `<head>`. Confirm `server.js` `contentType()` maps `.svg` → `image/svg+xml`.
   - Verify PASS: `node --test tests/server.test.js`

4. Write failing test for: Partial reason badge visible in modal [R17]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given an entry with `status: 'partial'` and `reason: 'timeout'`, When the folder modal opens, Then the modal DOM contains text "Alasan: timeout"
   Exercise through: `loadApp` → `openFolderModal(entry)` → inspect modal body text
   Test doubles: None (entry passed directly); do NOT mock the modal renderer
   Expected RED: badge text absent
5. Run test — verify FAIL: `node --test tests/public.test.js`

6. Implement in `public/app.js` `renderFolderModal(entry)`: when `entry.reason` is present, render `<span class="reason-pill">Alasan: <reason></span>` (warning style). Handles `timeout`, `skipped=N`, `access_denied`. Verify PASS.

7. Write failing test for: Reason badge for skipped and access_denied [R17]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given entry reason `'skipped=15'` then `'access_denied'`, When modal opens each time, Then "Alasan: skipped=15" and "Alasan: access_denied" render respectively
   Exercise through: `openFolderModal` with each entry
   Test doubles: None
   Expected RED: badge text absent for those values
8. Run, implement/confirm, verify PASS.

9. **Explicit regression verification (R19, R20):**
   - Run `node --test tests/read-only.test.js` → must be green (no new forbidden patterns in server.js/public).
   - Run `node --test tests/public.test.js` → the scenario "public/ never uses exec/spawn or a hardcoded host:port" must pass (favicon.svg included in `public/` scan).
   - Run the full suite `node --test tests/*.test.js` (or `npm test`) → all green.
10. Refactor while green, commit: `git commit -m "feat(web): favicon and partial reason badge; verify read-only guards"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rules R12 (favicon), R17 (reason display), R19/R20 (regression guards).
server.js:411-430 (`contentType`), 426-470 (`serveStatic` with CSP from T3).
public/app.js:643-760 (`renderFolderModal`, `openFolderModal`).
public/index.html:1-20 (`<head>`).
tests/public.test.js (asset guard at ~line 479), tests/read-only.test.js.

## WHY THIS APPROACH
Complexity: standard
Justification: Two small features (static asset + badge) plus an explicit regression gate for the read-only invariant and asset guard, which the spec calls out as acceptance rules.

## SANDWICH CONTEXT
[CRITICAL: public/favicon.svg must not contain forbidden substrings; CSP headers must still apply to .svg.]
You are implementing T7 favicon + reason badge + regression for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — SVG file (not data URI); reason pill in modal.
Files in scope: public/favicon.svg (new), public/index.html, public/app.js, tests/public.test.js, tests/server.test.js.
Available after: T2 (reason field), T6 (modal focus work)
Architecture rule: Zero deps; favicon via existing serveStatic; read-only guards must stay green.
[RESTATE: favicon must not contain forbidden substrings; read-only + asset guards must pass.]

## DELIVERABLE
Given favicon.svg, When GET /favicon.svg, Then 200 image/svg+xml And CSP present
Given entry reason "timeout", When modal opens, Then "Alasan: timeout" visible
Given reason "skipped=15" / "access_denied", Then respective badges visible
Given full suite, When run, Then read-only and asset guards green
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - favicon.svg served 200 with correct content-type + CSP
  - <link rel="icon"> in index.html
  - Reason badge for timeout/skipped/access_denied
  - read-only.test.js green; public asset guard green; full suite green

Must-not-have:
  - Forbidden substrings in svg
  - Hardcoded host:port
  - Breaking sort/hide/history from T4/T5 or focus trap from T6

Open question risks:
  - None blocking

Rollback note:
  - Revert commit; favicon 404 returns, badge hidden

Red flags:
  - Adding npm dep → STOP
  - Modifying docker-compose.yml → STOP

## STOP CONDITIONS
Done when: favicon + reason badge GWT pass, read-only + asset guards green, `npm test` fully green.
Uncertain when: contentType needs svg mapping added → NEEDS_CONTEXT.
Escalate when: read-only or asset guard fails.
