# Task T4 — SSE scan streaming endpoint

**Phase:** 2
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 4: SSE scan streaming endpoint [depends: T2] [test-risk]

## OBJECTIVE
Add a `GET /api/scan/stream` Server-Sent Events endpoint that emits per-folder progress and a terminal done event, with clean disconnect handling.

Steps:
1. Write failing test for: SSE stream contract
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given the server is started with a fixture whitelist, When a client requests `GET /api/scan/stream`, Then the response has `content-type: text/event-stream`, emits at least one `event: folder` frame whose `data` is a JSON entry, and ends with an `event: done` frame carrying the full `{ entries, scannedAt, partial }` payload.
   Exercise through: the HTTP route (real server on 127.0.0.1)
   Test doubles: fixture whitelist roots (filesystem is real, small)
   Expected RED: route does not exist → 404.
2. Run test — verify FAIL: `node --test tests/server.test.js`
3. Write failing test for: disconnect cleanup
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given a client aborts the SSE request mid-stream, When the connection closes, Then the server stops work for that stream and does not throw or leak a listener.
   Exercise through: HTTP route + socket abort
   Test doubles: none
   Expected RED: no route/no cleanup path.
4. Run test — verify FAIL: `node --test tests/server.test.js`
5. Implement the route in `server.js`: set SSE headers (reuse `securityHeaders()`), stream `event: folder` per completed folder via the existing `onProgress`/`scanAll` loop, send `event: done`, and register `req.on('close')` to abort. Do not break the existing `GET /api/scan`.
6. Refactor while green; commit: `feat(server): add SSE scan streaming endpoint`

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md — Story 3 "Progress streaming" rule

## WHY THIS APPROACH
Complexity: standard
Justification: New HTTP route with a streaming contract; test level is integration (HTTP boundary) — hence `[test-risk]`.

## SANDWICH CONTEXT
[CRITICAL: `GET /api/scan` must keep working unchanged as the fallback]
You are adding an SSE streaming route to `server.js`.
Spec: docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
Design decision: Option A — SSE with polling fallback.
Files in scope: `server.js`, `tests/server.test.js`
Available after: T2 (walker emits progress)
Architecture rule: no new dependencies; plain `node:http` response streaming; keep CSP/security headers.
[RESTATE: access_denied/partial entries in the stream must keep their status and reason]

## DELIVERABLE
Given a client connects to `/api/scan/stream`, When scan progresses, Then `event: folder` frames stream per folder and `event: done` terminates the payload.
Given the client disconnects, When the socket closes, Then the server aborts that stream without error.
[must-not] Given the SSE route exists, When a client calls `GET /api/scan`, Then the existing JSON response must NOT change.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - `text/event-stream` headers + security headers preserved
  - Disconnect cleanup
  - Conventional commit
Must-not-have:
  - Removing or altering `GET /api/scan`
  - WebSockets or external deps
Open question risks:
  - Event frame shape consumed by T7 → keep the documented shape; if changed, report NEEDS_CONTEXT
Rollback note:
  - Remove the route; client (T7) falls back to `GET /api/scan`.
Red flags:
  - Existing `/api/scan` test breaks → STOP

## STOP CONDITIONS
Done when: stream contract + disconnect scenarios pass; existing scan tests green
Uncertain when: frame shape disputed
Escalate when: fallback endpoint regresses
