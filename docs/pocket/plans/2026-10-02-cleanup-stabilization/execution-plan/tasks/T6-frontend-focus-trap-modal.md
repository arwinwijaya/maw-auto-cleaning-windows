# Task T6 — Frontend — focus-trap modal

**Phase:** 2
**Depends:** T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: Frontend — focus-trap modal [depends: T5]

## OBJECTIVE
Make the folder guide modal keyboard-safe: Tab/Shift+Tab cycle within the modal, focus moves to the close button on open, and focus is restored to the trigger on close.

Steps:
1. Write failing test for: Tab cycles within modal [R15]
   Test file: `tests/public.test.js`
   Level: unit (vm context)
   Test intent: Given the modal is open, When the user presses Tab on the last focusable element, Then focus moves to the first focusable element in the modal
   Exercise through: `loadApp` → `openFolderModal(entry)` → dispatch `keydown` Tab → inspect `document.activeElement`
   Test doubles: Mock `document.activeElement` tracking (the Element mock records focus calls); do NOT mock the trap helper
   Expected RED: focus stays on last element / no wrap
2. Run test — verify FAIL: `node --test tests/public.test.js`

3. Implement in `public/app.js` **Tab-wrap only (do NOT implement focus-restore yet)**:
   - Add a trapFocus helper that collects focusable elements inside the modal and attaches a keydown listener for Tab/Shift+Tab that wraps focus.
   - `openFolderModal(entry)`: focus the close button after showing (do NOT save `lastFocused` yet — that comes in step 4).
   - In `tests/public.test.js`: ensure the Element mock tracks focus (add `focus()` that sets a shared `document.activeElement` if not already present).
   - Verify PASS: `node --test tests/public.test.js`

4. Write failing test for: Focus restored on close [R15]
   Test file: `tests/public.test.js`
   Level: unit
   Test intent: Given card X is focused and the user opens the modal then closes it (Escape), Then focus returns to card X
   Exercise through: `loadApp` → focus card → open → close → inspect activeElement
   Test doubles: Same as above
   Expected RED: focus not restored (only Tab-wrap implemented in step 3)
5. Run test — verify FAIL: `node --test tests/public.test.js`; implement save-lastFocused-on-open + restore-on-close, verify PASS; refactor while green, commit: `git commit -m "feat(web): focus-trap the folder guide modal"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rule R15 (Story 8).
public/app.js:729-760 (`openFolderModal`, `closeFolderModal`), 913-935 (`handleKeydown`, `init`).
tests/public.test.js — Element mock, loadApp.

## WHY THIS APPROACH
Complexity: standard
Justification: Keyboard behavior requires focus tracking in the test mock; isolated to modal open/close.

## SANDWICH CONTEXT
[CRITICAL: public/ must never contain forbidden patterns.]
You are implementing T6 focus trap for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — Tab wraps within modal, restore lastFocused on close.
Files in scope: public/app.js, tests/public.test.js.
Available after: T5
Architecture rule: Zero deps; no querySelectorAll dependency beyond DOM APIs.
[RESTATE: public/ must never contain forbidden patterns.]

## DELIVERABLE
Given modal open, When Tab on last, Then focus wraps to first
Given Shift+Tab on first, Then wraps to last
Given card focused + modal opened then closed, Then focus restored to card
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tab/Shift+Tab wrap within modal
  - Focus close button on open
  - Restore lastFocused on close
  - Prior tests still green

Must-not-have:
  - Forbidden patterns
  - Breaking sort/hide/history from T4/T5

Open question risks:
  - Element mock may need focus tracking

Rollback note:
  - Revert commit; trap disabled

Red flags:
  - Adding npm dep → STOP

## STOP CONDITIONS
Done when: focus trap GWT pass, `node --test tests/public.test.js` green.
Uncertain when: mock needs selector support → NEEDS_CONTEXT.
Escalate when: asset guard fails.
