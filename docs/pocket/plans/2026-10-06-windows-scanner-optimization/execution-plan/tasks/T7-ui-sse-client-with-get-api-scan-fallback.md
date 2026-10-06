# Task T7 — UI SSE client with GET /api/scan fallback

**Phase:** 2
**Depends:** T4, T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 7: UI SSE client with GET /api/scan fallback [depends: T4, T5] [test-risk]

## OBJECTIVE
Consume `/api/scan/stream` via EventSource to render incremental progress, and fall back to `GET /api/scan` when EventSource is unavailable or errors.

Steps:
1. Write failing test for: incremental render from SSE
   Test file: `tests/public.test.js`
   Level: integration (vm harness with injected EventSource mock)
   Test intent: Given an injected EventSource that emits two `folder` events then a `done` event, When scan starts, Then cards render incrementally for each folder event and the final `done` payload drives the completed render.
   Exercise through: scan trigger entrypoint
   Test doubles: injected `EventSource` mock; do NOT mock the render/state under test
   Expected RED: `app.js` uses only `fetch('/api/scan')` today.
2. Run test — verify FAIL: `node --test tests/public.test.js`
3. Write failing test for: fallback to GET /api/scan
   Test file: `tests/public.test.js`
   Level: integration
   Test intent: Given `EventSource` is undefined or emits an `error`, When scan runs, Then the client issues `GET /api/scan` and renders the JSON result; the existing `requestId` race-safety behavior is preserved.
   Exercise through: scan trigger entrypoint
   Test doubles: absent/broken EventSource mock + fetch mock
   Expected RED: no fallback path exists.
4. Run test — verify FAIL: `node --test tests/public.test.js`
5. Implement in `public/app.js`: prefer EventSource to `/api/scan/stream`, parse `folder` frames into incremental state, finalize on `done`, and fall back to the existing `fetch('/api/scan')` path on unavailability/error. Preserve `state.nextRequestId` race-safety and loading state.
6. Refactor while green; commit: `feat(web): stream scan progress with fetch fallback`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 3 "Progress streaming" rule; Story 1 (rendered results reuse T5 filter)

## WHY THIS APPROACH
Complexity: standard
Justification: New client transport + fallback with race-safety preservation; test level crosses HTTP + DOM (hence `[test-risk]`).

## SANDWICH CONTEXT
[CRITICAL: `GET /api/scan` fallback must always work if streaming fails]
You are adding the SSE client transport to the UI.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — SSE with polling/fetch fallback.
Files in scope: `public/app.js`, `tests/public.test.js`
Available after: T4 (endpoint), T5 (filter/render)
Architecture rule: vanilla JS; no dependencies; preserve `requestId` dedup + loading state.
[RESTATE: if EventSource fails, the app must still complete a scan via GET /api/scan]

## DELIVERABLE
Given SSE `folder` events, When received, Then cards render incrementally.
Given SSE `done`, Then the full result renders.
Given EventSource unavailable/errors, Then `GET /api/scan` is used and the result renders.
[must-not] Given an SSE failure, When falling back, Then the app must NOT leave the UI in a permanent loading state.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - Race-safety (`requestId`) preserved
  - Loading state cleared on both success and fallback
  - Conventional commit
Must-not-have:
  - Dropping the fetch fallback
  - Breaking existing scenario 1–3 public tests
Open question risks:
  - SSE frame shape from T4 → if it differs, report NEEDS_CONTEXT
Rollback note:
  - Remove EventSource usage; revert to `fetch('/api/scan')`.
Red flags:
  - Fallback removed or loading stuck → STOP

## STOP CONDITIONS
Done when: incremental + fallback scenarios pass; existing scan/race tests green
Uncertain when: frame shape mismatches T4
Escalate when: loading state can deadlock
