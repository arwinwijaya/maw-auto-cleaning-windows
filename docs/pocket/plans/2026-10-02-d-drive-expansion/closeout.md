# Closeout — 2026-10-02-d-drive-expansion

- **Plan:** docs/pocket/plans/2026-10-02-d-drive-expansion
- **Type:** flat
- **Started:** 2026-10-05  ·  **Closed:** 2026-10-05
- **Baseline SHA:** 7854f23  ·  **Final SHA:** d1d7e9d
- **Result:** CLOSED — all phases DONE, all reviewable tasks REVIEW_PASS

## Phases

### Phase 1 — execution-plan/index.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T1 | Establish multi-drive remapping and whitelist | e7d3c42 | REVIEW_PASS |
| T2 | Provide safe program guidance | ded89f3 | REVIEW_PASS |
| T3 | Add read-only Docker D: mount | b478371 | REVIEW_PASS |
| T4 | Verify missing-drive API behavior and document configuration | d1d7e9d | REVIEW_PASS |

_SHA range: 7854f23..d1d7e9d_

## Carried Forward

- **T1** (Minor): D: entries block (3 entries) duplicated in two branches of getWhitelist (TEST_FIXTURE_ROOT and default) — 2 occurrences, below 3× refactor threshold but a maintenance surface — server.js:298-300 and server.js:339-341
- **T1** (Minor): server.js exceeds ~300 lines (632) and getWhitelist exceeds ~50 lines (105) — pre-existing, not introduced by this diff — server.js:1-632, server.js:241-345
- **T1** (strength): Comprehensive test coverage for all new functionality (4 new test suites, 6 new tests) covering all GWT scenarios
- **T1** (strength): Backward compatibility maintained for legacy string mount (/mnt/c) — D: paths correctly left unmapped
- **T1** (strength): Clean separation of concerns with parseHostMount as parser, toContainerPath as single-path converter, applyHostMount as array mapper
- **T1** (strength): No new dependencies introduced; zero-dependency invariant preserved
- **T1** (strength): Graceful handling of edge cases: invalid JSON mount, missing drives (not_found), no mount configured, explicit displayPath preservation
- **T1** (strength): D: entries added exactly as specified (D:\Temp temp, D:\Program app, D:\Program Files app) with no D:\tmp duplicate
- **T1** (strength): All 76 existing tests pass; mechanical gate green
- **T2** (strength): Both D:\Program and D:\Program Files configured correctly with app guidance and observationOnly: true.
- **T2** (strength): UI correctly hides copyable commands and copy buttons for observation-only app folders while preserving Windows Settings uninstall steps.
- **T2** (strength): Existing temp folder guidance and copy commands remain fully functional.
- **T2** (strength): All unit tests pass successfully with zero new dependencies or build steps introduced.
- **T3** (strength): Both C: and D: bind mounts are explicitly read_only: true — no writable volumes introduced
- **T3** (strength): SCAN_HOST_MOUNT updated to JSON object {"c":"/mnt/c","d":"/mnt/d"} matching T1's parseHostMount expectations exactly — legacy string mount upgraded without breaking compatibility
- **T3** (strength): D: mount uses ${D_DRIVE_SOURCE:-D:\} allowing .env override for hosts without D: drive — addresses the open question risk of Docker bind source failure without claiming not_found behavior at container runtime
- **T3** (strength): Container hardening preserved: rootfs read_only: true, tmpfs only at /tmp, no-new-privileges:true, non-root USER in Dockerfile, port bound to 127.0.0.1 only
- **T3** (strength): docker compose config parses successfully with both mounts showing read_only: true
- **T3** (strength): All 76 tests pass including read-only static analysis guard that asserts mounts are read-only and no destructive commands in compose/Dockerfile
- **T4** (Minor): README.md:30 states 'Hanya 15 path whitelist yang dibaca' (in C: mount context) while total whitelist is 18; wording is ambiguous — could clarify as '15 C: paths via /mnt/c' or update to 18 for consistency with lines 52/63 — README.md:30
- **T4** (strength): Test directly implements the exact GWT scenario from DELIVERABLE: 'Given D: absent at scanner filesystem level When scan occurs Then D: entries not_found and C: entries unaffected'
- **T4** (strength): Test uses existing createFsStub pattern with ENOENT for missing D: roots while C: root resolves to real directory — realistic simulation
- **T4** (strength): All assertions precise: C: entry status=ready, fileCount=1, sizeBytes=5; D: entries status=not_found, fileCount=0, sizeBytes=0; body.partial=false
- **T4** (strength): README documentation clearly specifies: multi-drive SCAN_HOST_MOUNT JSON format, optional D: bind mount, D:-less host behavior (not_found, not partial), and app no-delete policy for 'app' group folders
- **T4** (strength): No fabricated RED test — the test is a real passing test exercising actual behavior
- **T4** (strength): Zero scope creep — changes limited to tests/server.test.js (one new test) and README.md (documentation updates) exactly as specified
- **T4** (strength): All 77 tests pass including the new regression test
- **T4** (strength): README satisfies must-not-have: it does NOT claim a mandatory D: mount works on D:-less hosts; it explicitly states a required D: mount would fail and keeps it optional

## Skipped Tasks

_None_
