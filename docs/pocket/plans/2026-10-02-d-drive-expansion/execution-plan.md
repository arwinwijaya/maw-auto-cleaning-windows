# EXECUTION PLAN — D-Drive Expansion & Multi-Drive Observability

**Date:** 2026-10-02
**Spec:** docs/pocket/spec/2026-10-02-d-drive-expansion/d-drive-expansion-spec.md
**Status:** draft
**Total tasks:** 4

---

## Execution Overview

### Recommended Order
```
T1 → T2, T3, T4 (parallel)
```
> Dependency order above is recommended; pocket-development enforces sequencing.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| A | T2, T3, T4 | T1 completes |

### Constraints Reminder
**Architecture:** Node 20+, zero dependencies, read-only scan, default whitelist and SCAN_ROOTS override, C: legacy mount mapping preserved. Docker read-only bind mounts.
**Out-of-scope:** Entire D: recursion; writes/deletions; new D: tab.
**Assumptions at risk:** D:\Temp and D:\tmp equivalent on Windows; D: Docker bind mount is optional (native fallback validated when D: absent).
**Sequencing:** Dependencies are recommended; shared `server.js` edits should be serialized.

### File Structure Map
```
Rule: Multi-drive whitelist and grouping
  Modify: server.js (KNOWN_GROUPS, normalizeGroup, getWhitelist default roots); tests/scan-roots.test.js
Rule: Missing D: handling
  Modify: server.js (scanFolder/scanAll not_found path — verified, not changed); tests/server.test.js; README.md
Rule: Container remapping
  Modify: server.js (toContainerPath, applyHostMount, SCAN_HOST_MOUNT parsing); docker-compose.yml; tests/scan-roots.test.js
Rule: Safe app guidance
  Modify: public/app.js; public/index.html; tests/public.test.js; README.md
```

---

## Pocket Packets

---

### Task 1: Establish multi-drive remapping and whitelist [prereq]

## OBJECTIVE
Steps:
1. Write failing tests for default D: entries and group: `tests/scan-roots.test.js`; unit; Given default roots When `getWhitelist()` resolves Then exactly one D:\Temp group temp and D:\Program, D:\Program Files group app with exact Windows paths; exercise `getWhitelist` and `scanAll` public exports; doubles: fixture for scanAll; expected RED: D: roots missing and app normalized to other.
2. Run and verify RED: `node --test tests/scan-roots.test.js`.
3. Add D: roots to built-in whitelist and app group; maintain existing override/fixture semantics; verify GREEN.
4. Write failing tests for multi-drive mapping: `tests/scan-roots.test.js`; unit; Given C: and D: paths with both mounts When `applyHostMount()` runs Then C:→/mnt/c, D:→/mnt/d, original `displayPath` preserved; legacy string `/mnt/c` maps C: as before; exercise exported helpers; doubles none; expected RED: D: path incorrectly maps to C:.
5. Run and verify RED: `node --test tests/scan-roots.test.js`.
6. Implement mapping without breaking legacy callers or SCAN_ROOTS override; verify GREEN and run `npm test`; refactor while green; commit `feat(server): support safe multi-drive roots and mounts`.

## REFERENCES LOADED
Spec `docs/pocket/spec/2026-10-02-d-drive-expansion/d-drive-expansion-spec.md` — Rules 1, 3; `server.js`, `tests/scan-roots.test.js`.

## WHY THIS APPROACH
Complexity: standard — same server.js root/mount boundary, serialized to avoid edits conflict.

## SANDWICH CONTEXT
[CRITICAL: Never add writes/deletions or follow symlinks; preserve SCAN_ROOTS override and existing C: mapping.]
Implement whitelist + remap for D-Drive Expansion.
Spec: `docs/pocket/spec/2026-10-02-d-drive-expansion/d-drive-expansion-spec.md`.
Design decision: automatic drive mapping with explicit D: read-only mount.
Files in scope: `server.js`, `tests/scan-roots.test.js`.
Available after: none.
Architecture rule: Node standard library only; preserve native Windows paths.
[RESTATE: Never add writes/deletions or follow symlinks; preserve SCAN_ROOTS override and existing C: mapping.]

## DELIVERABLE
Given default roots When requested Then exactly three D: entries with temp/app grouping.
Given both drive roots in container When remapped Then C: points at /mnt/c and D: points at /mnt/d with Windows display paths.
Given old string mount When existing tests run Then legacy C: behavior survives.

## QUALITY BAR
Must-have: no duplicate lowercase tmp; no wrong-drive traversal; `npm test` green.
Must-not-have: full-drive D: scan, new deps, file writes/deletions.
Open question risks: D:\Temp vs D:\tmp may be separate on unusual case-sensitive filesystem → report NEEDS_CONTEXT.

## STOP CONDITIONS
Done when: per-scenario RED then GREEN, full tests pass.
Uncertain when: requested override mapping semantics conflict with old tests.
Escalate when: a path can be resolved onto the wrong drive.

---

### Task 2: Provide safe program guidance [depends: T1]

## OBJECTIVE
Steps:
1. Write failing test in `tests/public.test.js`; unit/UI behavioral: Given D:\Program Files (group app) When guide opens Then user sees Windows Settings uninstall guidance and no delete/copy command for app entry; exercise actual guide rendering, not only static text; doubles: existing lightweight DOM fake or controlled source pattern (no new deps); expected RED: no dedicated app guide, generic delete instructions appear.
2. Run and verify RED: `node --test tests/public.test.js`.
3. Add app group labels, catalog entries and safe guide content in `public/app.js` and `public/index.html` as needed; ensure copy-command actions hidden/disabled for app; verify GREEN, run `npm test`, refactor while green; commit `feat(web): show uninstall-only guidance for program folders`.

## REFERENCES LOADED
Spec `docs/pocket/spec/2026-10-02-d-drive-expansion/d-drive-expansion-spec.md` — Rule 4; `public/app.js`, `public/index.html`, `tests/public.test.js`.

## WHY THIS APPROACH
Complexity: standard — app guide must not inherit generic destructive commands.

## SANDWICH CONTEXT
[CRITICAL: Program folders are observation-only; do not expose delete instructions for them.]
Implement UI guidance for app roots.
Spec: `docs/pocket/spec/2026-10-02-d-drive-expansion/d-drive-expansion-spec.md`.
Design decision: distinct app group, uninstall guidance.
Files in scope: `public/app.js`, `public/index.html`, `tests/public.test.js`.
Available after: T1.
Architecture rule: vanilla JS, no dependencies, no deletion operations.
[RESTATE: Program folders are observation-only; do not expose delete instructions for them.]

## DELIVERABLE
Given app folder When modal opens Then advise uninstall via Settings, with no deletion commands.
Given temp folder When modal opens Then existing temp guidance remains.

## QUALITY BAR
Must-have: both D:\Program and D:\Program Files use app guidance; tests green.
Must-not-have: deletion commands for app group, new dependencies or build step.
Open question risks: generic static guidance elsewhere may suggest manual deletion → inspect actual UI.

## STOP CONDITIONS
Done when: app UI behavior verified and full tests green.
Uncertain when: UI cannot distinguish group with current catalog.
Escalate when: destructive app command remains reachable.

---

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

---

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

---

## Plan Summary
| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|------------------|
| T1 | Multi-drive remap and whitelist | prereq | standard | D: roots, groups, mounts |
| T2 | Safe program guidance | T1 | standard | app has uninstall-only guide |
| T3 | Docker D: mount | T1 | lightweight | compose config, RO mounts |
| T4 | Missing-drive regression + docs | T1 | standard | D: not_found, C: ready |
