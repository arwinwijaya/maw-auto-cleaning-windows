# Task T4 — Verify missing-drive API behavior and document configuration

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 4: Verify missing-drive API behavior and document configuration [depends: T1]

## OBJECTIVE
Steps:
1. Add regression integration test in `tests/server.test.js`: Given fs stub where lstat of D: roots raises ENOENT but C: root exists When `scanAll()` runs Then each D: entry is `not_found` and C: remains `ready`; exercise `scanAll()` with explicit whitelistRoots to avoid host dependence; doubles: fake fs; expected RED: this may already pass because existing scanFolder handles ENOENT—if so, record the test as a passing characterization/regression guard, never claim a fabricated RED.
2. Run `node --test tests/server.test.js`; verify the explicit status assertions pass. Any new implementation needed must first add a separate failing assertion for the uncovered behavior.
3. Update `README.md` to describe D: folders, program-folder no-delete policy, multi-drive container mounts, and limitation/solution for D:-less hosts; run `npm test`; commit `test(scanner): cover missing D drive and document scope`.

## REFERENCES LOADED
Spec `docs/pocket/spec/2026-10-02-d-drive-expansion/d-drive-expansion-spec.md` — Rule 2; `tests/server.test.js`, `README.md`.

## WHY THIS APPROACH
Complexity: standard — cross-root failure isolation and truthful Docker-host limitation.

## SANDWICH CONTEXT
[CRITICAL: Missing roots must not block successful scans of other drives.]
Verify missing D: API behavior and document deployment.
Spec: `docs/pocket/spec/2026-10-02-d-drive-expansion/d-drive-expansion-spec.md`.
Design decision: native missing drive returns not_found; Docker mount availability must be established separately.
Files in scope: `tests/server.test.js`, `README.md`.
Available after: T1.
Architecture rule: read-only, no runtime dependencies.
[RESTATE: Missing roots must not block successful scans of other drives.]

## DELIVERABLE
Given D: absent at scanner filesystem level When scan occurs Then D: entries not_found and C: entries unaffected.
Given README When user configures Docker Then drive mount requirement and app no-delete policy are clear.

## QUALITY BAR
Must-have: missing-root regression test; no fabricated RED; documentation precise.
Must-not-have: claim Docker can start without D: if unverified; automatic deletion.
Open question risks: required D: bind mount on D:-less Docker host may conflict with spec.

## STOP CONDITIONS
Done when: integration test and full suite pass, docs reflect observed deployment behavior.
Uncertain when: Docker absent on test host.
Escalate when: mandatory mount breaks expected D:-less deployment; ask user to adjust spec or mount strategy.
