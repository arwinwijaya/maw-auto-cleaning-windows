# Foundation Hardening — Cleanup Web Scanner — Security headers — CSP + nosniff + referrer + frame deny (Phase 2 of 2)

**Date:** 2026-10-02
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T3, T5, T6, T7}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

- **T3:** Security headers — CSP + nosniff + referrer + frame deny [depends: T2] → [tasks/T3-security-headers-csp-nosniff-referrer-frame-deny.md](tasks/T3-security-headers-csp-nosniff-referrer-frame-deny.md)
- **T5:** Frontend — scan history, delta vs last non-partial, mark cleaned [depends: T4] → [tasks/T5-frontend-scan-history-delta-vs-last-non-partial-mark-cleaned.md](tasks/T5-frontend-scan-history-delta-vs-last-non-partial-mark-cleaned.md)
- **T6:** Frontend — focus-trap modal [depends: T5] → [tasks/T6-frontend-focus-trap-modal.md](tasks/T6-frontend-focus-trap-modal.md)
- **T7:** Favicon + partial reason badge + regression verification [depends: T2, T3, T6] → [tasks/T7-favicon-partial-reason-badge-regression-verification.md](tasks/T7-favicon-partial-reason-badge-regression-verification.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
