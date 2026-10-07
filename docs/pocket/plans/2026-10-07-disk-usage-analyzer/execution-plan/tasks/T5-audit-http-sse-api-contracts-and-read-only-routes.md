# Task T5 — Audit HTTP/SSE API contracts and read-only routes

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: Audit HTTP/SSE API contracts and read-only routes [depends: T1]

## OBJECTIVE
Verify `server.js` against HTTP/SSE GWT scenarios using `tests/disk-analyzer.test.js`.

Steps:
1. Audit `tests/disk-analyzer.test.js` test `HTTP API progressive scan and cancellation`:
   - Gated readdir blocks on `slow/`
   - `POST /api/scans` returns 202 scanId
   - `GET /api/scans/:id/tree/root` while scanning returns status 'scanning', partial true, fast.txt child, live totals (100 B, 1 file)
   - `POST /api/scans/:id/cancel` returns 202 cancelling
   - `GET /api/scans/:id/status` returns cancelled after release
2. Verify live treemap endpoint returns 200 with partial data during scan (not 409).
3. Add a characterization integration test in `tests/disk-analyzer.test.js` for configured missing roots: `/api/roots` lists configured root regardless of existence; starting a scan on it returns a session and terminal status/error `not_found`. The configured root remains visible; no preflight filesystem check is expected.
4. Add a characterization integration test in `tests/disk-analyzer.test.js` for cross-origin state-changing request rejection: send `Origin` that differs from request host to `POST /api/scans`; assert 403. Expected PASS: server already implements same-origin validation in `validSameOrigin()` (server.js line 277) and returns 403 for disallowed origins. This test documents existing behavior, not a new requirement.
5. Run HTTP tests:
   `node --test tests/disk-analyzer.test.js`
6. Verify characterization and cross-origin tests pass; if behavior contradicts baseline/spec, report a concern without changing server behavior absent explicit scope approval.
7. Commit verification status: `test(server): audit API contracts, missing roots, and cross-origin rejection`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rules: Progressive and explorable results; Safety and deployment

## WHY THIS APPROACH
Complexity: standard
Justification: HTTP/SSE integration test verifies progressive scanning, cancellation, and live partial tree data.

## SANDWICH CONTEXT
[CRITICAL: No PUT/PATCH/DELETE; POST only at scan/cancel; same-origin on mutations; localhost-only bind; opaque node IDs on wire; security headers on every response.]
You are auditing HTTP/SSE server verification.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: SSE for progress; live partial treemap during scanning; opaque IDs; strict read-only API.
Files in scope: server.js, tests/disk-analyzer.test.js
Available after: T1
Architecture rule: No mutation endpoints, no shell execution, no client paths on wire.
[RESTATE: No PUT/PATCH/DELETE; POST only at scan/cancel; same-origin on mutations; localhost-only bind; opaque node IDs on wire; security headers on every response.]

## DELIVERABLE
Given fast.txt and gated slow/, When scanning, Then live tree returns fast.txt + live totals with status 'scanning' and partial true.
Given running scan, When cancel posted, Then status reaches cancelled without waiting on held read.
Given running scan, When treemap requested, Then returns 200 with partial data (not 409).
Given a cross-origin POST to a state-changing endpoint, When validated, Then server rejects it with 403.

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - `tests/disk-analyzer.test.js` passes

Must-not-have:
  - Mutating routes, shell execution, client paths on wire

## STOP CONDITIONS
Done when: DELIVERABLE verified and HTTP test passes
Escalate when: constraint violated
