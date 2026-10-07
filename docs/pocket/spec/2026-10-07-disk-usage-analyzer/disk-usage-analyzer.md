# Disk Usage Analyzer — Retrospective Specification

**Date:** 2026-10-07  
**Status:** draft — retrospective specification of committed implementation  
**Spec path:** `docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md`  
**Implementation baseline:** commit `086dfc934a0683367f5ad0c0a8b334fa74fc9441`

---

## Summary

A zero-dependency local web application that analyzes configured Windows drive roots in a read-only manner. It progressively aggregates disk usage, lets users browse a lazy folder tree and treemap, sort/filter large items, view extension and largest-item summaries, and inspect text-only cleanup guidance. Its primary goal is helping users find the largest space consumers. The application cannot delete or modify scanned files and never executes guidance commands.

This document formalizes behavior already present at the implementation baseline; it is not authorization to expand the feature set.

## Context

### Current State

- Node.js built-ins (`node:http`, `node:fs`) and vanilla browser JavaScript; Node.js >=20.
- No runtime or development dependencies (`package.json` dependencies are empty).
- Modular monolith: analyzer, classifier, guides, node registry, bounded concurrency helper, HTTP/SSE server, static UI.
- Tests use `node:test`; frontend tests use `node:vm` and a hand-written DOM stub rather than a DOM dependency.
- The implementation is committed at the baseline SHA above. Retrospective verification at handoff: `node --test` reports 30 passing tests.

### Related Areas

- `lib/analyzer.js` — recursive walk, aggregation, deadlines, partial semantics.
- `lib/concurrency.js` — bounded `mapLimit` helper.
- `lib/tree-registry.js` — opaque node id issuance/lookup.
- `lib/classifier.js` — exact-path risk/category rules.
- `lib/cleanup-guides.js` — 11 text-only guides.
- `lib/format.js` — human-readable size formatting.
- `server.js` — HTTP/SSE routes, sessions, security headers, static serving.
- `public/index.html`, `public/app.js` — UI tree, dashboards, treemap, guides.
- `tests/analyzer.test.js`, `tests/disk-analyzer.test.js`, `tests/concurrency.test.js`, `tests/format.test.js`, `tests/read-only.test.js`, `tests/ui-regression.test.js`.
- `Dockerfile`, `docker-compose.yml`, `.env.example` — deployment/safety posture.

### User Problem / Success

Users need to identify which folders, files, and extensions consume the most disk space, then explore those locations. They should be able to consult cleanup guidance without granting the application power to perform cleanup.

**Success signal:** a user can scan a configured root, see drive totals and largest items, sort/filter and drill into the tree, and review/copy manual guidance while the application remains incapable of modifying host files.

## Scope

### In-Scope

- Configured-root discovery and scan creation/cancellation.
- Bounded-concurrency recursive walk (default 16 workers) with recursive size/file/folder aggregation and extension totals.
- Live partial tree/progress via SSE and lazy per-node child lookup; live partial treemap data while scanning.
- Per-node partial state and reasons for timeout, cancellation, inaccessible or unavailable paths; partial aggregates are lower bounds.
- Symlink/junction/reparse-point skipping; never follow links.
- Opaque server-issued node IDs (16 hexadecimal characters derived from SHA-1 of path); client tree requests resolve IDs through the active session registry, not client-supplied filesystem paths.
- Windows display-path mapping for container mounts using `SCAN_HOST_MOUNT`; classification runs against display paths.
- Exact-path risk/category classification and the 11 committed text-only cleanup guides. Guides may display/copy command text; commands are never run.
- UI: drive/dashboard summary, lazy hierarchical tree, sorting/filtering, folders/files rankings, treemap, extension summary, guide view, scan controls, Indonesian blue/purple visual language.
- Strict read-only behavior and security/deployment posture described below.

### Out-of-Scope

- Any file deletion, modification, movement, cleanup execution, or mutating HTTP endpoint.
- New behavior not present at the baseline commit, including paging for huge folders, SSE replay via `Last-Event-ID`, scan rate limiting, authentication, multi-user access, remote access, HTTPS, background indexing, persistent scan database, or editable roots UI.
- Expanding the committed classifier rules or adding guides.
- Claiming time-to-first-result or scan-completion SLA. Timeouts are safety bounds, not latency guarantees.

## Design Decision

**Chosen approach:** A single-process, zero-dependency Node.js modular monolith with a static vanilla-JS frontend, one bounded-concurrency recursive walker that publishes a live partial tree, opaque server-issued node ids for all client tree lookups, exact-path classification over Windows display paths, and SSE for progress/terminal events.

**Alternatives considered:**
- *Native desktop app (WinDirStat-style)* — rejected: no cross-platform browser UI, heavier distribution, and harder to keep provably read-only.
- *Third-party dependency stack (Express + a tree/treemap library)* — rejected: violates the zero-dependency, offline, auditable, minimal-attack-surface constraint.
- *Client-supplied path navigation* — rejected: unsafe (path traversal) and leaks filesystem structure; server-issued ids keep the wire opaque.

**Tradeoffs accepted:** reading through Docker bind mounts is slower than native (hence a smaller Docker timeout); progressive partial results are shown instead of waiting for completeness; timeouts are safety bounds, not latency guarantees.

## Dependencies

- Runtime: none (Node.js built-ins only, Node >= 20).
- Development/tests: none beyond `node:test` and `node:vm`.
- External services: none. Filesystem access is read-only.

## Rollback Plan

- The application holds no persistent state; scan sessions are in-memory (30-minute TTL, max 8). Restarting the process discards all scan state with no data loss.
- Deployment rollback is reverting the image/commit; there are no migrations, schema changes, or stored files to undo.

## Architecture and Operational Constraints

- Runtime: Node.js built-ins + vanilla JavaScript, zero dependencies.
- All `lstat`/`readdir` calls race a shared abort/deadline promise. Default native scan budget is 600,000 ms (`SCAN_TIMEOUT_MS` configurable); Docker compose sets 180,000 ms.
- Filesystem concurrency defaults to 16. Completed children attach to live parents as each finishes; the tree/UI refresh is throttled rather than guaranteed to a strict latency SLA.
- SSE event names: `progress`, `tree`, `done`, `cancelled`, `error`. An interrupted scan can retain completed partial data; cancellation is a terminal scan status, not a successful complete scan.
- Default application bind is `127.0.0.1`; Docker publishes only localhost. Docker host drive bind mounts are read-only, container root filesystem is read-only except `/tmp`, process runs as `node` (UID 1000).
- Security headers: CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`.
- No runtime filesystem writes/mutation APIs, no `child_process`/shell execution, and no `PUT`, `PATCH`, or `DELETE` routes. The only POST operations are scan creation and cancellation.
- Same-origin validation is applied to state-changing requests. No authentication is added; local-only operation remains the deployment boundary.
- In-memory sessions only (TTL 30 minutes, max 8 sessions); process restart discards scan state. No migration or persistent-data rollback is needed.

## Stories, Rules, and Examples

### Story 1 — Find the largest usage

As a local user, I want to scan a configured drive and see recursive size distribution, so that I can identify the biggest space consumers.

**Rules**
1. Each directory's size/file/folder totals aggregate completed descendants.
2. Scans use bounded concurrency (default 16) and a single configurable global deadline (default 10 minutes; Docker 3 minutes).
3. Completed children are published progressively. A subtree that could not be fully read is marked partial; values are lower bounds.
4. Symlinks, junctions and reparse points are skipped and never traversed.
5. Ordinary access errors/skipped entries do not crash the whole scan. A deadline/abort winner marks the affected node/ancestor partial.
6. Configured roots are listed from configuration without a preflight existence check; a root scan that returns `ENOENT` is reported as `not_found`, while a root `lstat` that times out/aborts yields an empty partial root result.

**Examples / GWT**

- **Complete aggregate:** Given a root containing `A/a.bin` (3,000 B), `A/deep/a.log` (1,000 B), `B/b.txt` (500 B), and `root.md` (100 B), when analysis completes, then totals equal 4,600 B and 4 files, with A=4,000 B and B=500 B.
- **Empty root:** Given an empty configured root, when analysis completes, then totals are zero and `partial=false`.
- **Link safety:** Given a symbolic link, junction, or reparse point under the root, when scanning, then it is skipped and its target is not followed.
- **Permission failure:** Given an entry that returns `EACCES` or `EPERM`, when scanning, then that entry is skipped and the scan proceeds.
- **Deadline:** Given a child filesystem operation remains unresolved past the global deadline, when the deadline fires, then the scan returns without awaiting that operation and affected results are partial with timeout reason.
- **Cancellation:** Given a child filesystem operation is held open, when the user cancels, then the scan reaches `cancelled` without waiting for the held operation, while already completed siblings remain visible.
- **Unavailable root:** Given a configured root path is unavailable, when roots are requested, then it remains listed because roots are derived from configuration; when scanning it returns `ENOENT`, then the scan reports `not_found` rather than crashing root enumeration.

### Story 2 — Explore progressive results

As a user, I want to see completed results during scanning and drill into folders, so I can find large items without waiting for the whole scan.

**Rules**
1. The live root is published before the walk completes; each completed child attaches to its parent and generates a tree notification.
2. SSE communicates progress and terminal events; the UI throttles live tree refreshes and preserves expanded nodes.
3. Tree and treemap endpoints can serve live partial state during scanning.
4. Tree and treemap requests use server-issued opaque IDs; arbitrary client paths are not accepted as node selectors.
5. UI supports committed size/file/folder/percentage/name/date sort modes and path/minimum-size filtering.

**Examples / GWT**

- **Live sibling:** Given `fast.txt` is scanned while another directory read remains blocked, when `fast.txt` completes, then the live root exposes it with updated byte/file totals while scan status remains `scanning` and the response is marked partial.
- **Live treemap:** Given a scan is in progress, when the treemap is requested for the root, then the endpoint returns current available data with `status=scanning` and `partial=true`.
- **Opaque lookup:** Given a node ID issued by the active server-side registry, when a client requests that node's children, then only the registered node is resolved; a filesystem path supplied by the client is not used as a path.
- **Sort/filter:** Given visible rows, when the user selects a supported sort mode or path/minimum-size filter, then rows are ordered/filtered accordingly without changing scan data.

### Story 3 — Assess risk and read manual guidance

As a user, I want known paths classified and cleanup guidance shown as text, so I can make an informed decision and act outside the application.

**Rules**
1. Classification uses Windows display paths, including paths remapped from Docker mounts.
2. Only explicit rules yield known categories/risks; unmatched paths remain `unknown`.
3. Guide commands are display/copy-only; application code never executes them.

**Examples / GWT**

- **Mapped path:** Given a Docker path under `/mnt/c` maps to Windows `C:\`, when a known Windows temp path is classified, then classification uses the Windows display path and returns its configured guide/risk.
- **Unknown path:** Given a display path matches no explicit classification rule, when classified, then risk/category are `unknown` and no cleanup recommendation is guessed.
- **Copy-only command:** Given a text guide lists a command, when the user selects Copy, then the command text is copied to the clipboard and no process is spawned.

### Story 4 — Keep scanning read-only

As a user, I need the analyzer to be unable to modify host files, so scanning cannot damage my data.

**Rules**
1. Runtime contains no filesystem mutation operation and no shell/process execution.
2. HTTP API exposes no PUT/PATCH/DELETE route; POST is limited to scan creation and cancellation.
3. Docker drive mounts and root filesystem are read-only; process runs non-root.
4. CSP/security headers and same-origin validation protect the local API surface.

**Examples / GWT**

- **Static safety audit:** Given runtime modules and server routes, when the read-only tests execute, then forbidden mutation/process patterns and mutating routes are absent.
- **Docker safety:** Given compose/Dockerfile configuration, when the safety test inspects it, then host bind mounts are read-only, root filesystem is read-only, and the application runs as non-root.
- **Cross-origin mutation:** Given a state-changing request from a disallowed origin, when the server validates it, then the request is rejected.

## Acceptance Criteria

### Rule: Recursive read-only analysis
- ✓ Given a normal nested tree, when scan completes, then recursive size/file/folder totals match the files discovered.
- ✓ Given a symlink/reparse point or access-denied child, when scanning, then it is skipped and never followed.
- ✓ Given a held filesystem operation, when abort or global timeout wins, then the scan returns promptly with partial state rather than waiting for that operation.
- ✓ Given a configured root path is missing, when roots are enumerated, then it remains listed from configuration; when scanned, the missing path is reported as `not_found`.

### Rule: Progressive and explorable results
- ✓ Given one sibling is complete and another is blocked, when the live tree/treemap is requested, then completed sibling data and current totals are returned with scanning/partial state.
- ✓ Given a server-issued node ID, when tree children are requested, then the registry resolves that ID without accepting a client-supplied filesystem path.
- ✓ Given sort/filter controls, when applied, then displayed rows follow the selected committed mode/criteria.

### Rule: Path classification and manual guidance
- ✓ Given a mapped Windows display path matching a committed classifier rule, when classified, then configured risk/category/guide metadata is returned.
- ✓ Given an unmatched path, when classified, then it remains unknown.
- ✓ Given copyable guide command text, when copied, then no command executes.

### Rule: Safety and deployment
- ✓ Given runtime and route audit, when tests run, then filesystem mutation and shell spawning are absent and no mutating HTTP routes exist.
- ✓ Given Docker configuration, when tests run, then all host binds and container root filesystem are read-only and process is non-root.
- ✓ Given a cross-origin state-changing request, when submitted, then it is rejected.

## Open Questions / Assumptions

- The specification is retrospective; test and scenario names describe intended observable contracts, while exact response fields should remain those of the committed API.
- No strict first-result time is promised because filesystem latency varies by host/mount. Existing progressive publication/throttling is the accepted behavior.
- The edge-case hunter suggested pagination, SSE resume, rate limiting, environment-variable expansion and expanded UNC/WSL handling. These are not present in baseline scope and are excluded, not blockers.

## Handoff Notes for Pocket Planning

- Treat commit `086dfc934a0683367f5ad0c0a8b334fa74fc9441` as implementation baseline; do not rebuild or expand the already shipped feature.
- Focus plan tasks on verifying the spec against committed behavior, documenting contracts, and independent review/test evidence. Any discovered defect requires explicit scope approval before editing.
- Preserve zero dependencies, read-only invariants, localhost-only deployment, and all existing tests.
