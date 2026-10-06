# Task T1 — Repo foundation hygiene (package.json, git, nul, docs)

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 1: Repo foundation hygiene (package.json, git, nul, docs) [prereq] [no-tdd — structural task]

## OBJECTIVE
Establish repo hygiene so every later change is testable and revertible.

Steps:
1. Create `package.json` at repo root with `name: cleanup-web-scanner`, `version: 1.0.0`, `private: true` (no `type` field → default commonjs compatible with existing `require`), `scripts: { test: "node --test", start: "node server.js" }`, `engines: { node: ">=20" }`, `dependencies: {}`, zero runtime deps.
2. Create `.gitignore` containing at minimum: `nul`, `.env`, `.env.local`, `node_modules/`, `*.log`, `.scan.json`, `.scan.txt`, `*.tmp`, `.tmpcheck/`. Verify `.dockerignore` already contains `nul` (add if missing).
3. Remove stray file `nul` at repo root: from PowerShell `Remove-Item -LiteralPath .\nul -Force`. Verify `ls nul` fails.
4. Run `git init` (if no `.git`), `git branch -M main`, `git add` intentional files, initial commit `chore: init repo with stable baseline`. Verify `git status` shows only intentional files.
5. Update `README.md`: keep Docker section as primary, add `## Jalankan native (Windows)` section below Docker with `node server.js` instruction and note "Jika Docker Desktop tidak jalan, gunakan jalur native." Include Node version note.
6. Verify: `npm test` (or `node --test`) → 46+ pass; `git status` clean; `ls nul` → not found; `git check-ignore nul` → ignored.
7. Commit: `git commit -m "chore(repo): init package.json, gitignore, remove nul, document native fallback"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rules R1, R2, R3, R18 (Foundation Hygiene + Native Fallback).
server.js — `DEFAULT_PORT`, `resolveHost`.
tests/read-only.test.js — explicit file list (package.json/.gitignore not inspected; must not add forbidden patterns to inspected files).

## WHY THIS APPROACH
Complexity: lightweight
Justification: Structural scaffolding with no behavioral logic; no test doubles needed. Verifiable via shell commands. Must run first to unblock `npm test` and git history.

## SANDWICH CONTEXT
[CRITICAL: Zero runtime dependencies — never add a runtime dep; server.js must stay vanilla node:http.]
You are implementing T1 foundation hygiene for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — Incremental Hardening.
Files in scope: package.json (new), .gitignore (new), README.md, .dockerignore, nul (delete), .git/ (init). Must not touch lib/resolve-temp.js, lib/format.js, docker-compose.yml, public/app.js, server.js.
Available after: none (prereq)
Architecture rule: Zero runtime deps; additive changes only; preserve read-only invariant.
[RESTATE: Zero runtime dependencies — never add a runtime dep.]

## DELIVERABLE
[no-tdd — structural task] R1: Given package.json with "test": "node --test", When npm test, Then exit 0, 46+ pass.
R2: Given .gitignore with nul, .env, node_modules/, When git status, Then clean.
R3: Given nul deleted & in .gitignore, When ls nul, Then not found.
R18: Given README.md, When reading, Then section "Jalankan native (Windows)" exists with "node server.js".
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - package.json with `test: node --test`, zero deps; `npm test` passes
  - .gitignore covers nul, .env, node_modules/
  - nul deleted and ignored by git and docker
  - README native section present with node server.js
  - git branch main, initial commit present
  - [no-tdd — structural task]

Must-not-have:
  - Any runtime dependency added
  - Whitelist/API contract changes
  - Touching lib/resolve-temp.js or docker-compose.yml

Open question risks:
  - None blocking for this task

Rollback note:
  - `git revert` the commit

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Must-not behavior (new dep) → STOP

## STOP CONDITIONS
Done when: `npm test` 46+ pass, `git status` clean, nul absent/ignored, README native section present, no forbidden patterns introduced.
Uncertain when: `npm test` fails due to Node <20 → report NEEDS_CONTEXT with Node version.
Escalate when: forbidden pattern detected in new files.
