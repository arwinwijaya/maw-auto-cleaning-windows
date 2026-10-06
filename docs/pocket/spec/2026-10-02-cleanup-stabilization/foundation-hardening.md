# Foundation Hardening — Cleanup Web Scanner

**Date:** 2026-10-02
**Status:** approved
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md

---

## Summary

The Cleanup Web Scanner functions (46 tests pass) but has high friction for daily use: no `package.json`/`npm test`, no git history, stray `nul` file, missing favicon/CSP, no scan history for before/after comparison, and no way to mark "cleaned". This spec hardens the foundation with repo hygiene, information density improvements (sort, hide-zero, history, delta, mark-cleaned), security headers, and native fallback docs — all without breaking the read-only invariant or adding runtime dependencies.

---

## Context

### Current State
- Node 24.16.0, vanilla `node:http` server (~540 lines), zero runtime deps
- Docker-only deployment (Linux container, `C:\` bind-mounted read-only to `/mnt/c`)
- Frontend: `public/index.html` + `public/app.js` (no build step)
- Tests: 6 files, 46 tests via `node:test` (run via `node --test` without args)
- Read-only invariant enforced by `tests/read-only.test.js` (explicit file list + forbidden patterns)
- Whitelist: 15 folders in 4 groups (temp, system, logs, cache)
- API: `GET /api/scan` returns entries with `status: ready|partial|access_denied|not_found`, `fileCount`, `sizeBytes`, `sizeHuman`, `partial` top-level flag
- No `package.json`, no `.git`, no `favicon`, no CSP, no `localStorage` usage, no history

### Problem / Motivation
1. **Repo hygiene:** No `npm test`, no git, stray `nul` file, no native fallback docs
2. **Information density:** 15 cards unsorted, 12 often zero — user must hunt for large folders
3. **No history/delta:** Cannot verify cleanup effectiveness without manual comparison
4. **Security:** No CSP, no security headers, 404 favicon
5. **Accessibility:** Modal not focus-trapped
6. **Partial scans opaque:** User sees `partial` but not *why* (timeout vs skipped)

### Related Areas
- `server.js` (HTTP, scan logic, `makeEntry`, headers)
- `public/app.js` (UI: `renderScan`, `renderCard`, `renderGuide`, modals, `init`)
- `public/index.html` (markup, inline `<style>`)
- `tests/public.test.js` (vm context, `loadApp`, scenarios 1–9)
- `tests/server.test.js` (API contract)
- `tests/read-only.test.js` (static analysis guard)
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `README.md`

---

## Scope

### In-Scope
1. **Foundation Hygiene:** `package.json` (zero-dep, `npm test` = `node --test`), `git init` + `.gitignore` (excludes `nul`, `.env`, `node_modules/`), remove `nul`, native fallback docs in README
2. **Sort by size desc** within each group, persistent via localStorage
3. **Toggle "sembunyikan 0 B"** with chip restore, persistent via localStorage
4. **Scan History** (localStorage, max 20 entries, FIFO) + **Delta** vs last non-partial scan
5. **Mark Cleaned** button (local timestamp, displayed as relative time)
6. **Favicon** (`public/favicon.svg`)
7. **CSP + Security Headers** on all responses (CSP allows inline style block)
8. **Focus-trap Modal** (Tab/Shift+Tab cycle, restore on close)
9. **Partial Reason Field** (additive `reason` to entry JSON: `timeout|skipped=N|access_denied`) + frontend display

### Out-of-Scope
- Quick-scan backend / SSE progress / `?fast=1` (Direction B)
- Windows container / native installer / auto-start Docker Desktop
- Auto-delete / any execution affordance (read-only invariant preserved)
- Database, auth, multi-user, scheduled tasks, system tray
- Adding/changing whitelist folders
- Build step / bundler / TypeScript / React / new runtime deps

---

## Architecture Constraints

- Layers this work may touch: root (package.json, .gitignore, README), `public/` (index.html, app.js, favicon.svg), `server.js` (headers only, `makeEntry` signature), `tests/public.test.js` (vm context mock)
- Layers this work must NOT touch: `lib/resolve-temp.js`, `lib/format.js`, `docker-compose.yml` hardening, whitelist logic, read-only invariant
- Patterns that must be followed: zero runtime dependencies; no build step; additive API changes only; localStorage key versioned (`v1`); test-first
- Architecture validation result: PASS (validated Phase 6)

---

## Dependencies

### Existing (to leverage)
- `localStorage` (native browser API) — history, prefs, cleaned timestamp
- `node:vm` (test context) — already used in `public.test.js`
- `node:test` — test runner, already works

### New (proposed)
- **none** — zero runtime dependencies maintained

---

## Stories + Scenarios

### Story 1: Foundation Hygiene
> As a developer/maintainer, I want repo with `package.json` (`npm test` works), `git init` (`.gitignore` clean), no stray `nul` file, so that every change can be tested & rolled back with confidence.

**Rule 1: npm test runs all tests**
- Example A: `npm test` → exit 0, 46+ pass
- Example B: `node --test` (no args) → exit 0, 46+ pass

**Rule 2: git status clean**
- Example C: `git status` → only intentional files (package.json, .gitignore, favicon.svg, README.md modified)

**Rule 3: nul removed & ignored**
- Example D: `ls nul` → not found; `git check-ignore nul` → ignored
- Example E: `docker compose build` → `.dockerignore` excludes `nul`, image clean

```gherkin
Scenario: npm test runs all tests and passes
  Given clean repo with package.json containing "test": "node --test"
  When running `npm test`
  Then exit code 0
  And output shows "46 pass, 0 fail"

Scenario: git status shows only intentional files
  Given repo with .gitignore containing nul, .env, node_modules/
  When running `git status`
  Then nul not listed
  And .env not listed
  And node_modules/ not listed

Scenario: Docker build ignores nul
  Given .dockerignore contains "nul"
  When docker compose build
  Then build context does not include nul file
```

### Story 2: Sort by Size Descending (Within Group)
> As a user, I want folder cards sorted by size descending within each group, so that largest folders appear first without manual hunting.

**Rule 1: Cards sorted by sizeBytes descending per group**
- Example A: Temp group: Local\Temp 2.2GB, Windows\Temp 724KB → Local\Temp first
- Example B: Equal sizes → stable order by original index (deterministic)

**Rule 2: Preference persistent in localStorage**
- Example C: Fresh load → sort desc ON (default); toggle OFF → reload → still OFF

```gherkin
Scenario: Cards sorted by size descending within group
  Given scan result with Temp group: Local\Temp 2.2GB, Windows\Temp 724KB
  When renderScan called
  Then first card in Temp group is Local\Temp

Scenario: Sort preference persists across reload
  Given user toggled sort OFF
  When page reloaded
  Then sort still OFF
  And cards in original order
```

### Story 3: Hide Zero-Byte Folders
> As a user, I want to hide folders with 0 files / 0 B, so that noise is reduced and large folders stand out.

**Rule 1: Toggle hides entries with `fileCount === 0 && sizeBytes === 0`**
- Example A: 12 zero folders → toggle ON → hidden, chip "12 folder kosong disembunyikan" appears
- Example B: Chip click → folders restored, chip disappears

**Rule 2: Preference persistent, default OFF (show all)**
- Example C: Fresh load → all shown; toggle ON → reload → still hidden

```gherkin
Scenario: Hide zero folders toggles visibility
  Given scan result with 12 zero-byte folders
  When user clicks "sembunyikan 0 B" toggle
  Then zero-byte folders removed from DOM
  And chip "12 folder kosong disembunyikan" visible
  And chip click restores them

Scenario: Hide-zero preference persists across reload
  Given user toggled hideZero ON
  When page reloaded
  Then hideZero still ON
  And zero folders hidden
```

### Story 4: Scan History + Delta
> As a user, I want scan history and delta "turun X sejak <waktu>", so that I know if cleanup was effective without manual comparison.

**Rule 1: Each scan saved to `cleanupScanner.history.v1` (max 20, FIFO)**
- Example A: 21 scans → history length 20, oldest (scan #1) dropped

**Rule 2: Delta computed vs last non-partial scan**
- Example B: Previous scan partial (1.1 GB), last good 2.5 GB, current 1.0 GB → delta = 1.5 GB (vs 2.5 GB)
- Example C: First scan → no delta shown

**Rule 3: UI shows "Terakhir dipindai: <waktu>" + "Turun X sejak <waktu baseline>" (if decrease)**
- Example D: Delta shown with relative time of baseline scan

```gherkin
Scenario: History stores up to 20 scans
  Given 21 successful scans
  When reading localStorage cleanupScanner.history.v1
  Then array length = 20
  And oldest entry is scan #2

Scenario: Delta displayed when previous non-partial scan exists
  Given previous scan totalBytes = 2_500_000_000 (partial: false)
  And current scan totalBytes = 1_100_000_000
  When renderScan renders
  Then UI shows "Turun 1,4 GB sejak <relative time of previous scan>"

Scenario: No delta on first scan
  Given localStorage history empty
  When first scan completes
  Then UI shows only "Terakhir dipindai: <now>"
  And no delta text

Scenario: Partial scans excluded from delta baseline
  Given history: scan 1 (partial, 1.1GB), scan 2 (ready, 2.5GB), scan 3 (ready, 1.0GB)
  When scan 3 renders
  Then delta computed vs scan 2 (2.5GB) → "Turun 1,5 GB sejak <scan 2 time>"
```

### Story 5: Mark Cleaned (Local Annotation)
> As a user, I want to mark "sudah dibersihkan" manually, so that I have a local reminder of when I last cleaned.

**Rule 1: Button "✓ Sudah dibersihkan" appears after scan in Results tab**
- Example A: Scan completes → button visible

**Rule 2: Click saves `cleanupScanner.lastCleanedAt` (ISO string) to localStorage**
- Example B: Click → localStorage updated

**Rule 3: UI displays "Terakhir dibersihkan: <relative time>" if set**
- Example C: `lastCleanedAt` = 2 hours ago → "Terakhir dibersihkan: 2 jam lalu"

**Rule 4: Data never sent to server; does not affect scan logic**
- Example D: New scan runs → result independent; delta vs previous scan, not vs cleaned time

```gherkin
Scenario: Mark cleaned stores timestamp locally
  Given scan completed
  When user clicks "✓ Sudah dibersihkan"
  Then localStorage cleanupScanner.lastCleanedAt set to current ISO time

Scenario: Cleaned timestamp displayed
  Given lastCleanedAt = 2 hours ago
  When page loaded
  Then UI shows "Terakhir dibersihkan: 2 jam lalu"

Scenario: Mark cleaned does not affect scan
  Given lastCleanedAt exists
  When new scan runs
  Then scan result independent of lastCleanedAt
  And delta calculated vs previous scan, not vs lastCleanedAt
```

### Story 6: Favicon
> As a user, I want a favicon in browser tab, so that tab is recognizable and no 404 log noise.

**Rule 1: `public/favicon.svg` exists (simple 32×32 SVG)**
**Rule 2: `index.html` links `<link rel="icon" href="/favicon.svg">`**
**Rule 3: Request returns 200, `image/svg+xml`**

```gherkin
Scenario: Favicon served correctly
  Given public/favicon.svg exists
  When GET /favicon.svg
  Then status 200
  And content-type image/svg+xml
  And no 404 in server log
```

### Story 7: CSP + Security Headers
> As a user, I want standard security headers, so that attack surface is minimal (XSS, clickjacking, MIME sniffing).

**Rule 1: All responses have CSP header:**
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

**Rule 2: All responses have `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`**

**Rule 3: CSP allows inline `<style>` block (via `'unsafe-inline'` in style-src)**
**Rule 4: CSP allows external `app.js` and fetch to `/api/scan`**

```gherkin
Scenario: CSP header present on all responses
  Given server running
  When GET /, /app.js, /api/scan, /favicon.svg
  Then each response has Content-Security-Policy header
  And policy includes default-src 'self', script-src 'self', connect-src 'self'

Scenario: CSP allows inline style block
  Given index.html has <style> block
  When page loads in browser
  Then styles applied (no CSP violation)

Scenario: Security headers present
  Given any response
  Then X-Content-Type-Options: nosniff
  And Referrer-Policy: no-referrer
  And X-Frame-Options: DENY
```

### Story 8: Focus-Trap Modal
> As a keyboard user, I want Tab to stay inside modal, so that I don't accidentally escape to body.

**Rule 1: Tab on last focusable → wraps to first**
**Rule 2: Shift+Tab on first → wraps to last**
**Rule 3: Open modal → focus `modal-close` (or first focusable)**
**Rule 4: Close modal (Escape/click backdrop/close btn) → restore `lastFocused`**

```gherkin
Scenario: Tab cycles within modal
  Given modal open
  When user presses Tab on last focusable element
  Then focus moves to first focusable element in modal

Scenario: Focus restored on close
  Given card X focused, user opens modal, then closes with Escape
  Then focus returns to card X
```

### Story 9: Partial Reason Display
> As a user, I want to know why a folder is `partial` (timeout vs skipped), so that I'm not confused and can take action (e.g., re-run).

**Rule 1: Backend adds optional `reason` field to entry when `status === 'partial' || 'access_denied'`**
- Values: `"timeout"`, `"skipped=N"`, `"access_denied"`

**Rule 2: Additive — field absent when `ready`/`not_found`**

**Rule 3: Frontend displays "Alasan: <reason>" badge in modal**

```gherkin
Scenario: Partial entry includes reason field
  Given folder scan times out (context timeout)
  When GET /api/scan
  Then entry for that folder has status "partial"
  And entry.reason == "timeout"

Scenario: Skipped files partial includes count
  Given folder has 100 files, 15 skipped (locked)
  When GET /api/scan
  Then entry.reason == "skipped=15"

Scenario: Frontend displays reason
  Given entry with reason "timeout"
  When modal opens for that folder
  Then "Alasan: timeout" badge visible
```

### Story 10: Native Fallback Documentation
> As a user, I want to know how to run without Docker, so that tool works even if Docker Desktop is down.

**Rule 1: README has `## Jalankan native (Windows)` section below Docker**
**Rule 2: Contains `node server.js` instruction (Node 20+ in PATH)**
**Rule 3: Notes "Jika Docker Desktop tidak jalan, gunakan jalur native."**

```gherkin
Scenario: README documents native fallback
  Given README.md
  When reading
  Then section "Jalankan native (Windows)" exists
  And contains "node server.js"
  And mentions "Jika Docker Desktop tidak jalan"
```

---

## Acceptance Criteria

```
Rule: R1 — npm test runs all tests
  ✓ Given package.json with "test": "node --test", When npm test, Then exit 0, 46+ pass

Rule: R2 — git repo clean
  Given .gitignore with nul, .env, node_modules/, When git status, Then clean

Rule: R3 — nul removed & ignored
  Given nul deleted & in .gitignore, When ls nul, Then not found

Rule: R4 — Sort by size desc within group
  ✓ Given scan with Local\Temp 2.2GB, Windows\Temp 724KB, When render, Then Local\Temp first
  ✓ Given toggle OFF, When reload, Then still OFF

Rule: R5 — Hide zero folders
  ✓ Given 12 zero folders, When toggle ON, Then hidden, chip shows "12 folder kosong disembunyikan"
  ✓ Chip click restores

Rule: R6 — Preferences persist
  ✓ Given user toggles, When reload, Then state restored from localStorage

Rule: R7 — History stores 20 scans
  ✓ Given 21 scans, When read history, Then length = 20, oldest dropped

Rule: R8 — Delta from last non-partial scan
  ✓ Given previous partial (1.1GB), last good (2.5GB), current (1.0GB), Then delta = 1.5GB (vs 2.5GB)

Rule: R9 — No delta on first scan
  ✓ Given empty history, When first scan, Then only "Terakhir dipindai"

Rule: R10 — Mark cleaned stores timestamp
  ✓ Given scan done, When click "✓ Sudah dibersihkan", Then lastCleanedAt set

Rule: R11 — Cleaned timestamp displayed
  ✓ Given lastCleanedAt = 2h ago, When load, Then "Terakhir dibersihkan: 2 jam lalu"

Rule: R12 — Favicon served
  ✓ Given favicon.svg, When GET /favicon.svg, Then 200, image/svg+xml

Rule: R13 — CSP + security headers on all responses
  ✓ Given any route, When response, Then CSP, nosniff, no-referrer, DENY present

Rule: R14 — CSP allows inline style block
  ✓ Given page loads, When style applied, Then no CSP violation

Rule: R15 — Focus trap in modal
  ✓ Given modal open, When Tab on last, Then focus wraps to first
  ✓ Given close, Then focus restored to trigger

Rule: R16 — Partial entries have reason field
  ✓ Given timeout, When /api/scan, Then entry.reason = "timeout"
  ✓ Given skipped=15, Then reason = "skipped=15"
  ✓ Given access_denied, Then reason = "access_denied"

Rule: R17 — Frontend displays reason
  ✓ Given modal open for partial, Then "Alasan: timeout" visible

Rule: R18 — Native fallback documented
  ✓ Given README, When read, Then section exists with node server.js

Rule: R19 — No read-only invariant violation
  ✓ Given read-only.test.js, When run, Then pass (no new forbidden patterns)

Rule: R20 — public/ asset guard passes
  ✓ Given public.test.js asset guard, When run, Then pass
```

---

## Design Decision

**Chosen option:** Option A — Incremental Hardening

**Summary:** Implement all 10 stories as small, isolated diffs. Each story touches few files, reuses existing patterns (vm mock, `makeEntry`, `renderCard`, `makeDocument`), adds zero runtime deps, preserves zero-build philosophy.

**Rejected options:**
- Option B (Feature Flag / Config-Driven): adds indirection/complexity for single-user tool; over-engineered
- Option C (Full Rewrite): violates architecture constraints (zero-dep, no build step, Docker simplicity)

**Key tradeoffs accepted:**
- `localStorage` mock added to test vm context (slight test coupling, but cleanest)
- Partial scans excluded from delta baseline (adds logic but prevents false deltas)
- CSP `'unsafe-inline'` for style-src (justified by existing `<style>` block, no build step)

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Partial reason field: additive API change OK? | assumed: yes (additive, backward-compatible) | If tests do deepEqual on entry object — but they assert individual fields |
| CSP `style-src 'unsafe-inline'` acceptable? | assumed: yes (1 style block, no build) | If CSP audit requires nonce/hash — would need build step |
| History retention 20 enough? | assumed: yes (~50KB localStorage, safe) | If user wants years of history — would need export/import |
| Sort default desc ON, hideZero OFF acceptable UX? | assumed: yes (decision speed > no surprise) | If user expects alphabetical — can toggle |
| "Tandai sudah dibersihkan" button keep? | assumed: yes (scope confirmed) | If user finds it confusing — can hide behind flag |

---

## Implementation Notes

- **Test vm context:** Must add `localStorage` mock to `loadApp()` in `tests/public.test.js` (Map-backed, `getItem`/`setItem`/`removeItem`/`clear`/`key`/`length`) — unblocks Stories 2–5.
- **`makeEntry` signature:** Add optional 5th param `reason` (string|undefined). All 5 call sites in `server.js` propagate. No test breaks (field-by-field asserts).
- **History key:** `cleanupScanner.history.v1` — array of `{ scannedAt, totalBytes, partial, entries: { [name]: { sizeBytes, fileCount } } }`.
- **Prefs key:** `cleanupScanner.prefs.v1` — `{ sortBySizeDesc: true, hideZero: false }`.
- **Cleaned key:** `cleanupScanner.lastCleanedAt` — ISO string.
- **Favicon:** Simple SVG, e.g., `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect fill="#4a90d9" width="32" height="32" rx="4"/><path fill="white" d="M8 12h16v2H8zm0 6h16v2H8zm0 6h16v2H8z"/></svg>` (broom-ish).
- **CSP middleware:** Single helper in `server.js` applied to all `writeHead` calls.
- **Focus trap:** Reusable `focusTrap(element)` helper in `app.js`.
- **Delta computation:** Walk history backwards for first `partial === false` entry.

---

## Rollback Plan

1. `git revert` individual commits (one per story)
2. If localStorage keys cause issues: version bump to `v2` with migration (keys are namespaced)
3. If CSP breaks anything: remove CSP header helper, revert to no-CSP (feature-flag style via env var if needed)
4. `nul` removal: `git restore nul` if accidentally needed (but it's a Windows artifact, not needed)