# Windows Scanner Performance, UX, and Profile Optimization — Execution Index

**Date:** 2026-10-06
**Spec:** docs/pocket/spec/2026-10-06-windows-scanner-optimization/scanner-optimization.md
**Source Plan:** ../execution-plan.md
**source-sha256:** d225da7ab8af3173d2de5a8f26fe5d3721f86d41ad92cbb43f24188489cec0b1
**Total Tasks:** 7
**Total Phases:** 2

---

## Execution Flow

```
T1,T3,T5(PARALLEL)→T2,T6(PARALLEL)→T4→T7
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — Bounded concurrency helper module (T1, T3, T5)
- **Phase 2:** [phase-2.md](phase-2.md) — walkFolder bounded concurrency, dirent reuse, strict deadline regression (T2, T6, T4, T7)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | Bounded concurrency helper module | Phase 1 | [T1-bounded-concurrency-helper-module.md](tasks/T1-bounded-concurrency-helper-module.md) | [prereq] |
| T3 | Profile resolution hardening + fallback marker | Phase 1 | [T3-profile-resolution-hardening-fallback-marker.md](tasks/T3-profile-resolution-hardening-fallback-marker.md) | [prereq] |
| T5 | UI hide not_found with reveal chip and empty state | Phase 1 | [T5-ui-hide-not-found-with-reveal-chip-and-empty-state.md](tasks/T5-ui-hide-not-found-with-reveal-chip-and-empty-state.md) | [prereq] |
| T2 | walkFolder bounded concurrency, dirent reuse, strict deadline regression | Phase 2 | [T2-walkfolder-bounded-concurrency-dirent-reuse-strict-deadline-regression.md](tasks/T2-walkfolder-bounded-concurrency-dirent-reuse-strict-deadline-regression.md) | [depends: T1] [test-risk] |
| T6 | UI fallback exemption badge | Phase 2 | [T6-ui-fallback-exemption-badge.md](tasks/T6-ui-fallback-exemption-badge.md) | [depends: T3, T5] |
| T4 | SSE scan streaming endpoint | Phase 2 | [T4-sse-scan-streaming-endpoint.md](tasks/T4-sse-scan-streaming-endpoint.md) | [depends: T2] [test-risk] |
| T7 | UI SSE client with GET /api/scan fallback | Phase 2 | [T7-ui-sse-client-with-get-api-scan-fallback.md](tasks/T7-ui-sse-client-with-get-api-scan-fallback.md) | [depends: T4, T5] [test-risk] |
