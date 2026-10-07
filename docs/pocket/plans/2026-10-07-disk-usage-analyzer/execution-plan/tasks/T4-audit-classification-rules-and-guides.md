# Task T4 — Audit classification rules and guides

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 4: Audit classification rules and guides [depends: T1]

## OBJECTIVE
Verify `lib/classifier.js` and `lib/cleanup-guides.js` against classification and guide GWT scenarios.

Steps:
1. Audit existing tests:
   - "analyze maps real mount paths onto Windows display paths" → covers mapped display path classification
   - "classify unknown path" → test `classify('C:\\Unknown\\Path')` in `tests/analyzer.test.js`
2. Run classification tests:
   `node --test tests/analyzer.test.js --test-name-pattern="classify\|maps real mount"`
3. Verify all 11 guides in `lib/cleanup-guides.js` exist with required fields (id, title, description, commands array).
4. Commit verification status: `test(classifier): audit classification rules and guides against baseline`

## REFERENCES LOADED
docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md — rule: Path classification and manual guidance

## WHY THIS APPROACH
Complexity: lightweight
Justification: Classification rules and guides are static data; verified via existing tests.

## SANDWICH CONTEXT
[CRITICAL: Classification runs on Windows display paths only; unknown paths default to unknown; 11 guides are text-only, never executed.]
You are auditing classification and guide verification.
Spec: docs/pocket/spec/2026-10-07-disk-usage-analyzer/disk-usage-analyzer.md
Design decision: 15 exact-path rules, 11 text-only guides.
Files in scope: lib/classifier.js, lib/cleanup-guides.js, tests/analyzer.test.js
Available after: T1
Architecture rule: No guessed recommendations for unknown paths; no command execution.
[RESTATE: Classification runs on Windows display paths only; unknown paths default to unknown; 11 guides are text-only, never executed.]

## DELIVERABLE
Given mapped Windows display path, When classified, Then configured risk/category/guide metadata returned.
Given unmatched path, When classified, Then risk/category are unknown.
Given guides module, When enumerated, Then 11 text-only guides exist.

## QUALITY BAR
Must-have:
  - [no-tdd — verification-only task]
  - Classification tests pass; 11 guides confirmed

Must-not-have:
  - New classifier rules or guides not present at baseline

## STOP CONDITIONS
Done when: DELIVERABLE verified
Escalate when: constraint violated
