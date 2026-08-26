# M31 UX/UI redesign evidence

## Scope

Local production-build verification of the ENNCO public surface, diagnostic,
identity flow, Control Room shell and an operational table. This evidence does
not authorize publication, external sending or production changes.

## Binding

- Baseline commit: `f35c77a8140e954712432d0921ad76dabb1d8f06`
- Frontend worktree fingerprint: `d0ee319587d75cce671b16ea7a433aab4cd3e83b7012ebf4d736838785915fa9`
- Evidence class: `LOCAL_WORKTREE_VISUAL_QA`
- Release eligible: `false`
- External side effects: `0`

The repository contained coordinated work before this redesign. The redesign
preserved that worktree and is therefore bound to exact file hashes rather than
misrepresented as a clean release commit.

## Visual comparison

The `before/` directory contains the last available M23 captures for Control
Room and diagnostic. The `after/` directory contains 20 full-page captures:
five surfaces at 1440, 1280, 768 and 390 CSS pixels. Every after-capture SHA-256
is recorded in `report.json`.

## Results

- Browser matrix: 20 of 20 captures, PASS_LOCAL.
- Playwright enterprise matrix: 256 passed and 4 deterministic profile skips.
- Vitest: 64 files and 301 tests passed.
- Lint, typecheck and production build: PASS.
- Horizontal overflow: 0.
- CSP violations: 0.
- Unexpected external requests: 0.
- Runtime failures: 0.
- Mobile LCP p75: 768 ms for `/` and 772 ms for `/operacion` under simulated
  3G and 4x CPU throttling.
- Maximum observed mobile CLS: 0.035592, below the 0.1 budget.
- Reduced-motion transition duration: at most 0.01 ms.
- k6 smoke: 203 requests at 20.28 requests per second, p95 21.11 ms, 0 request
  failures, 0 dropped iterations and 406 of 406 checks.

## Boundaries

- Automated Chromium checks do not replace an audit with assistive technology,
  Safari or physical devices.
- Performance is local production-build evidence, not staging or production
  telemetry.
- No Vercel preview or production deployment was created.
- Public indexing, campaign authorization and outbound gates remain fail closed.
