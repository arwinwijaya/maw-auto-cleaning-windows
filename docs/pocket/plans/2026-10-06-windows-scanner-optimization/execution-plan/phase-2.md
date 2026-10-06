# Windows Scanner Performance, UX, and Profile Optimization — walkFolder bounded concurrency, dirent reuse, strict deadline regression (Phase 2 of 2)

**Date:** 2026-10-06
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T2, T6, T4, T7}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

- **T2:** walkFolder bounded concurrency, dirent reuse, strict deadline regression [depends: T1] [test-risk] → [tasks/T2-walkfolder-bounded-concurrency-dirent-reuse-strict-deadline-regression.md](tasks/T2-walkfolder-bounded-concurrency-dirent-reuse-strict-deadline-regression.md)
- **T6:** UI fallback exemption badge [depends: T3, T5] → [tasks/T6-ui-fallback-exemption-badge.md](tasks/T6-ui-fallback-exemption-badge.md)
- **T4:** SSE scan streaming endpoint [depends: T2] [test-risk] → [tasks/T4-sse-scan-streaming-endpoint.md](tasks/T4-sse-scan-streaming-endpoint.md)
- **T7:** UI SSE client with GET /api/scan fallback [depends: T4, T5] [test-risk] → [tasks/T7-ui-sse-client-with-get-api-scan-fallback.md](tasks/T7-ui-sse-client-with-get-api-scan-fallback.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
