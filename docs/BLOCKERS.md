# Blockers

## Phase 3 — RESOLVED

Date: 2026-10-02

The previous P3 CI blockers are resolved in the `social-engine` branch:
- `lib/social-radar.js` date parsing now uses real JavaScript regexes for ISO, numeric, month-name, and whitespace normalization cases.
- `_api/admin-page-html.js` was regenerated from the current `admin.html` source.
- `tests/feature2-exam-tracker.test.js` now checks dynamic-rendering anchors instead of asserting client-generated attributes in static HTML.
- Continuous CI no longer assumes a lockfile that the repository does not contain; it uses `npm install --no-audit --no-fund`.

Verification on current branch:
- CI: PASS — 135 tests, 135 pass, 0 fail.
- Social Engine Phase 1 Tests: PASS.
- Gitleaks: PASS.
- Manual radar helper checks: seven-day, three-day, and closing-today windows all returned the expected events.

No Phase 3 code blocker remains. Production deployment is separately blocked by the connected Vercel scope/rate-limit state described in the owner checklist.

## Phase 4 — TESTED

Graphics export/upload implementation is present and the full CI suite is green on `social-engine-3` commit `242d80f213cc5fa7b61edca2343a222e388f4901`.

## Phase 6 — TESTED

Instagram Login two-step publishing is implemented and covered by mocked API tests. CI is green on `social-engine-5` commit `c0fee84a46760f0a7f5c3239b0904d27e2988007`.

## Phase 7 — TESTED

Daily Radar preview is implemented as a read-only admin operation. CI is green at 146/146 tests on `social-engine-6` commit `32beeb2673ecab7650e8074f297656d47ab3b575`.
