# Task T1 — Establish multi-drive remapping and whitelist

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
