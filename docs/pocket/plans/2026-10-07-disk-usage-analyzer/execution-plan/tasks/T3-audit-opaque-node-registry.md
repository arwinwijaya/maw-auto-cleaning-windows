# Task T3 — Audit opaque node registry

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: Audit opaque node registry [depends: T1]

## OBJECTIVE
Verify `lib/tree-registry.js` against opaque ID GWT scenarios using existing tests.

Steps:
1. Audit existing test in `tests/analyzer.test.js`:
   - "node registry issues stable opaque ids resolved by id only" → covers 16-char SHA-1 hex issuance and lookup.
2. Verify the opaque-lookup API contract in `server.js` lines 471–493: tree endpoints resolve `nodeIdParam` via `session.registry.get(id)` and never accept a client-supplied filesystem path. No additional unit test is needed — the existing HTTP test `HTTP API progressive scan and cancellation` in `tests/disk-analyzer.test.js` exercises this by fetching `/api/scans/:id/tree/root` and `/api/scans/:id/tree/:nodeId` with server-issued IDs only.
3. Run test:
   `node --test tests/analyzer.test.js --test-name-pattern="node registry"`
4. Verify test passes.
5. Commit verification status: `test(registry): audit opaque node registry GWT scenarios against baseline`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rule: Recursive read-only analysis (opaque IDs)

## WHY THIS APPROACH
Complexity: lightweight
Justification: Registry is small and self-contained; verified via existing test.

## SANDWICH CONTEXT
[CRITICAL: Client never receives filesystem paths; only server-issued opaque IDs (16-char SHA-1 hex).]
You are auditing the node registry tests.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: Opaque server-issued IDs prevent path traversal.
Files in scope: lib/tree-registry.js, tests/analyzer.test.js
Available after: T1
Architecture rule: No client-supplied paths accepted as node selectors.
[RESTATE: Client never receives filesystem paths; only server-issued opaque IDs (16-char SHA-1 hex).]

## DELIVERABLE
Given same path, When nodeId called, Then returns stable 16-char SHA-1 hex.
Given registered node, When registry.get(id) called, Then returns node.

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - Registry test passes

## STOP CONDITIONS
Done when: DELIVERABLE verified
Escalate when: constraint violated
