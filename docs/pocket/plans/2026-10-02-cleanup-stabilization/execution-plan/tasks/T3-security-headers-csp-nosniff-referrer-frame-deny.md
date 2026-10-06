# Task T3 — Security headers — CSP + nosniff + referrer + frame deny

**Phase:** 2
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: Security headers — CSP + nosniff + referrer + frame deny [depends: T2]

## OBJECTIVE
Add CSP and security headers to every HTTP response without breaking the inline `<style>` block or `fetch('/api/scan')`.

Steps:
1. Write failing test for: CSP header present on all responses [R13]
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given server running, When GET /, /app.js, /api/scan, Then each response has `content-security-policy` including `default-src 'self'`, `script-src 'self'`, `connect-src 'self'`; And `x-content-type-options: nosniff`; And `referrer-policy: no-referrer`; And `x-frame-options: DENY`
   Exercise through: `createServer` HTTP boundary (real server on ephemeral port)
   Test doubles: None
   Expected RED: CSP header missing (undefined)
2. Run test — verify FAIL: `node --test tests/server.test.js`

3. Implement in `server.js` **CSP without unsafe-inline first**:
   - Add a security-headers helper returning the CSP policy per spec R13 but with the style-src directive restricted to `'self'` only (no `unsafe-inline`), plus the three additional security headers per spec R13.
   - Merge the helper into the JSON response path and the static-file response path.
   - Verify PASS for R13 test: `node --test tests/server.test.js --test-name-pattern="CSP header present"`

4. Write failing test for: CSP declares inline-style allowance [R14]
   Test file: `tests/server.test.js`
   Level: integration
   Test intent: Given index.html has a single `<style>` block, When GET /, Then the `content-security-policy` header's style-src directive includes `'unsafe-inline'`
   Exercise through: `createServer` GET /
   Test doubles: None
   Expected RED: style-src directive lacks `'unsafe-inline'` (policy is `style-src 'self'`)
5. Run test — verify FAIL: `node --test tests/server.test.js --test-name-pattern="CSP declares inline-style allowance"`

6. Add `'unsafe-inline'` to the CSP style-src directive in the security-headers helper and verify PASS for R14, commit: `git commit -m "feat(server): add CSP and security headers to all responses"`

## REFERENCES LOADED
docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md — Rules R13, R14 (Story 7).
server.js:36-45 (`json`), 426-470 (`serveStatic`), 462-492 (`createServer`).
public/index.html:7 — single `<style>` block (justifies unsafe-inline).

## WHY THIS APPROACH
Complexity: lightweight
Justification: One helper + two call sites. Verifiable via header asserts.

## SANDWICH CONTEXT
[CRITICAL: Read-only invariant; CSP must not block existing <style> block or fetch('/api/scan').]
You are implementing T3 security headers for Foundation Hardening.
Spec: docs/pocket/spec/2026-10-02-cleanup-stabilization/foundation-hardening.md
Design decision: Option A — style-src 'unsafe-inline' justified by single <style> block, no build step.
Files in scope: server.js (header helper + json/serveStatic), tests/server.test.js.
Available after: T2
Architecture rule: Headers on every response; policy exact as spec; zero deps.
[RESTATE: Never add destructive patterns; CSP must allow existing style block.]

## DELIVERABLE
Given server running, When GET /, /app.js, /api/scan, Then CSP + nosniff + no-referrer + DENY present
Given index.html has <style>, When GET /, Then CSP style-src includes 'unsafe-inline'
Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - CSP exact policy on every route including 404/500
  - Three additional security headers
  - Existing tests still pass

Must-not-have:
  - Blocking inline style
  - Blocking app.js or /api/scan fetch
  - Adding a dependency (helmet etc.)

Open question risks:
  - CSP unsafe-inline acceptable; if auditor requires nonce → would need build step

Rollback note:
  - Revert commit; remove helper

Red flags:
  - New dependency → STOP
  - Touching docker-compose.yml → STOP

## STOP CONDITIONS
Done when: header asserts pass, `node --test` green, manual `curl -I /` shows CSP.
Uncertain when: policy debated → NEEDS_CONTEXT.
Escalate when: read-only guard fails.
