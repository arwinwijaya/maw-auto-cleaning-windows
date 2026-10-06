# Foundation Hardening — Cleanup Web Scanner — Repo foundation hygiene (package.json, git, nul, docs) (Phase 1 of 2)

**Date:** 2026-10-02
**Original plan:** ../execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T4}
**Unlocks next:** Phase 2

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T1:** Repo foundation hygiene (package.json, git, nul, docs) [prereq] [no-tdd — structural task] → [tasks/T1-repo-foundation-hygiene-package-json-git-nul-docs.md](tasks/T1-repo-foundation-hygiene-package-json-git-nul-docs.md)
- **T2:** Backend — partial reason field on scan entries [depends: T1] → [tasks/T2-backend-partial-reason-field-on-scan-entries.md](tasks/T2-backend-partial-reason-field-on-scan-entries.md)
- **T4:** Test mock fix + sort by size + hide-zero + prefs persistence [depends: T1] → [tasks/T4-test-mock-fix-sort-by-size-hide-zero-prefs-persistence.md](tasks/T4-test-mock-fix-sort-by-size-hide-zero-prefs-persistence.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
