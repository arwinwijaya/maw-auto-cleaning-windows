# Task T3 — Add read-only Docker D: mount

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: Add read-only Docker D: mount [depends: T1]

## OBJECTIVE
Steps:
1. Update `docker-compose.yml` with D:\ bind mounted to /mnt/d using `type: bind` and `read_only: true`; configure matching multi-drive mapping without breaking legacy C: configuration.
2. Validate with `docker compose config` (if Docker CLI unavailable, report BLOCKED and do not assert validation passed); check both mounts remain read-only, and `npm test` passes.
3. Commit `chore(docker): mount D drive read-only for scan`.

## REFERENCES LOADED
Spec `docs/pocket/spec/2026-10-02-d-drive-expansion/d-drive-expansion-spec.md` — Rule 3; `docker-compose.yml`, `Dockerfile`.

## WHY THIS APPROACH
Complexity: lightweight — structural config with parser verification; `[no-tdd — structural task]`.

## SANDWICH CONTEXT
[CRITICAL: Both host drive mounts must be read-only.]
Implement container mount for D:.
Spec: `docs/pocket/spec/2026-10-02-d-drive-expansion/d-drive-expansion-spec.md`.
Design decision: explicit D: bind mount.
Files in scope: `docker-compose.yml`.
Available after: T1.
Architecture rule: retain non-root, read-only rootfs, no-new-privileges.
[RESTATE: Both host drive mounts must be read-only.]

## DELIVERABLE
Given D: exists on Docker host When container starts Then D: folder paths resolve under /mnt/d read-only.

## QUALITY BAR
Must-have: both mounts RO and environment compatible with T1.
Must-not-have: writable volume or unexpected root mount.
Open question risks: D: absent causes Docker bind source failure; do not claim not_found behavior at container runtime without proof.
[no-tdd — structural task]

## STOP CONDITIONS
Done when: compose config parses and mount mapping is confirmed.
Uncertain when: Docker not installed or no D: available for runtime validation.
Escalate when: startup on D:-less hosts fails contrary to spec expectation; seek decision on optional mount vs documented limitation.
