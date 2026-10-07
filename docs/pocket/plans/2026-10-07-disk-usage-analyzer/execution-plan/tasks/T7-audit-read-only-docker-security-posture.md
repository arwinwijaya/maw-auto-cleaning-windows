# Task T7 — Audit read-only/Docker/security posture

**Phase:** 2
**Depends:** T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 7: Audit read-only/Docker/security posture [depends: T5]

## OBJECTIVE
Verify runtime, Docker, and security configurations enforce read-only invariants using `tests/read-only.test.js`.

Steps:
1. Audit existing tests in `tests/read-only.test.js` (4 tests):
   - `runtime code never mutates the filesystem or spawns processes`
   - `server exposes no mutating HTTP routes`
   - `docker compose mounts every host path read-only`
   - `dockerfile runs as non-root and never deletes`
2. Verify the Dockerfile rootfs read-only claim: `docker-compose.yml` line 44 sets `read_only: true` on the service, and line 45 mounts `/tmp` as `tmpfs` — the only writable filesystem. The test `dockerfile runs as non-root and never deletes` plus the compose audit together cover the acceptance criterion.
3. Run read-only tests:
   `node --test tests/read-only.test.js`
4. Verify all 4 tests pass.
5. Run full test suite:
   `node --test`
6. Verify 30/30 tests pass across all test files.
7. Commit verification status: `test(security): audit read-only and Docker posture against baseline`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rule: Safety and deployment

## WHY THIS APPROACH
Complexity: standard review
Justification: Static safety audit across runtime files, server routes, Dockerfile, and compose configuration.

## SANDWICH CONTEXT
[CRITICAL: No fs mutation APIs, no shell execution, no mutating routes, Docker host binds read-only, container rootfs read-only, non-root USER, CSP/headers on all responses.]
You are auditing read-only security posture.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: 100% read-only at every layer — runtime, container, API, deployment.
Files in scope: tests/read-only.test.js, Dockerfile, docker-compose.yml, server.js, lib/analyzer.js, lib/classifier.js, lib/cleanup-guides.js, lib/concurrency.js, lib/format.js, lib/tree-registry.js
Available after: T5
Architecture rule: Read-only is an invariant, not a best effort.
[RESTATE: No fs mutation APIs, no shell execution, no mutating routes, Docker host binds read-only, container rootfs read-only, non-root USER, CSP/headers on all responses.]

## DELIVERABLE
Given runtime modules, When audited, Then no forbidden fs mutation or shell spawn calls exist.
Given server.js, When audited, Then no PUT/PATCH/DELETE routes exist.
Given Docker config, When audited, Then host binds are read-only, rootfs is read-only, process is USER node.
Given full suite, When run, Then 30/30 tests pass.

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - All 4 read-only tests pass; full suite 30/30 passes

Must-not-have:
  - Any mutating behavior or writable volume

## STOP CONDITIONS
Done when: DELIVERABLE verified and 30/30 tests pass
Escalate when: constraint violated
