# Foundation Hardening — Cleanup Web Scanner — Execution Index

**Date:** 2026-10-02
**Spec:** docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
**Source Plan:** ../execution-plan.md
**source-sha256:** 96f105cd2c8ac00563c67e6b384b104268f11fda4f8cfe0a5cb0cc6633a69e9b
**Total Tasks:** 7
**Total Phases:** 2

---

## Execution Flow

```
T1→T2,T4(PARALLEL)→T3,T5(PARALLEL)→T6→T7
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — Repo foundation hygiene (package.json, git, nul, docs) (T1, T2, T4)
- **Phase 2:** [phase-2.md](phase-2.md) — Security headers — CSP + nosniff + referrer + frame deny (T3, T5, T6, T7)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | Repo foundation hygiene (package.json, git, nul, docs) | Phase 1 | [T1-repo-foundation-hygiene-package-json-git-nul-docs.md](tasks/T1-repo-foundation-hygiene-package-json-git-nul-docs.md) | [prereq] [no-tdd — structural task] |
| T2 | Backend — partial reason field on scan entries | Phase 1 | [T2-backend-partial-reason-field-on-scan-entries.md](tasks/T2-backend-partial-reason-field-on-scan-entries.md) | [depends: T1] |
| T4 | Test mock fix + sort by size + hide-zero + prefs persistence | Phase 1 | [T4-test-mock-fix-sort-by-size-hide-zero-prefs-persistence.md](tasks/T4-test-mock-fix-sort-by-size-hide-zero-prefs-persistence.md) | [depends: T1] |
| T3 | Security headers — CSP + nosniff + referrer + frame deny | Phase 2 | [T3-security-headers-csp-nosniff-referrer-frame-deny.md](tasks/T3-security-headers-csp-nosniff-referrer-frame-deny.md) | [depends: T2] |
| T5 | Frontend — scan history, delta vs last non-partial, mark cleaned | Phase 2 | [T5-frontend-scan-history-delta-vs-last-non-partial-mark-cleaned.md](tasks/T5-frontend-scan-history-delta-vs-last-non-partial-mark-cleaned.md) | [depends: T4] |
| T6 | Frontend — focus-trap modal | Phase 2 | [T6-frontend-focus-trap-modal.md](tasks/T6-frontend-focus-trap-modal.md) | [depends: T5] |
| T7 | Favicon + partial reason badge + regression verification | Phase 2 | [T7-favicon-partial-reason-badge-regression-verification.md](tasks/T7-favicon-partial-reason-badge-regression-verification.md) | [depends: T2, T3, T6] |
