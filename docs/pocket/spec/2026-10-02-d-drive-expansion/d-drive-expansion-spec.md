# Spec: D-Drive Expansion & Multi-Drive Observability
Date: 2026-10-02 | Project: auto-cleaning (Cleanup Web Scanner) | Status: approved

## 1. Context & Problem Statement
Cleanup Web Scanner currently focuses exclusively on drive `C:`. Users with multi-drive setups require visibility into secondary drives, specifically `D:\Temp`, `D:\Program`, and `D:\Program Files`. However, unlike temporary files, program installation folders must be treated as observability-only (non-deletable via temp script) with distinct UI guidance.

## 2. Scope & Boundaries
- **In-Scope:**
  - Add `D:\Temp`, `D:\Program`, and `D:\Program Files` to the default whitelist in `server.js`.
  - Introduce `app` category in `KNOWN_GROUPS` for program directories.
  - Update `toContainerPath()` and `applyHostMount()` to dynamically support multi-drive remapping (`C:` → `/mnt/c`, `D:` → `/mnt/d`).
  - Update `docker-compose.yml` to bind-mount `D:\` to `/mnt/d:ro` (optional via environment/profile).
  - Graceful handling when drive `D:` is absent (`not_found`) — native Windows handles this; Docker requires D: bind mount or skips D: entries.
  - Dedicated UI guidance modal text for `app` group ("Uninstall via Settings", no delete commands).
- **Out-of-Scope:**
  - Recursive full-drive D: scanning.
  - Automated deletion or write actions (read-only invariant preserved).

## 3. GWT Acceptance Criteria

### Rule 1: Multi-drive Whitelist & Grouping
- **Scenario:** Scan includes D: drive folders
  - **Given** host has drive D: with `D:\Temp` and `D:\Program Files`
  - **When** user triggers `GET /api/scan`
  - **Then** response includes entries for `D:\Temp` (group `temp`) and `D:\Program Files` (group `app`)

### Rule 2: Graceful Missing Drive Handling
- **Scenario:** Host lacks D: drive
  - **Given** host does not have drive D:
  - **When** user triggers `GET /api/scan`
  - **Then** D: whitelist entries return status `not_found` without throwing server errors

### Rule 3: Container Path Remapping
- **Scenario:** Multi-drive container path conversion
  - **Given** container environment with multi-drive bind mounts (`/mnt/c`, `/mnt/d`)
  - **When** `toContainerPath("D:\\Program Files\\App", ...)` is called
  - **Then** returns `/mnt/d/Program Files/App` with displayPath preserved as `D:\Program Files\App`

### Rule 4: Safe Guidance for App Group
- **Scenario:** Viewing guide for Program Files
  - **Given** scan finished with `D:\Program Files` entry
  - **When** user opens the folder guide modal
  - **Then** instructions advise uninstallation via Windows Settings instead of file deletion commands

## 4. Open Questions & Assumptions
- *Assumption:* `D:\Temp` covers temporary usage on D:; `D:\tmp` is subsumed to avoid redundant filesystem traversals.
- *Assumption:* Docker users on single-drive machines without D: will use the native Windows fallback (`node server.js`) for D: scan; Docker container requires the D: bind mount to be present. Docker configuration may use profiles or `.env` override to make the D: mount optional.
