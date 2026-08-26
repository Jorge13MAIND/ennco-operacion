# M24 production activation evidence

Date: 2026-08-20

Verdict: `PRODUCTION_PLATFORM_ACTIVE`, commercial outbound remains `HOLD`.

## Managed surfaces

- Vercel project: `ennco-operacion`
- Production URL: `https://ennco-operacion.vercel.app`
- Deployment inspector: `https://vercel.com/jorge13mainds-projects/ennco-operacion/A5qJxpNUW5XfxrCNPgzW6LoDv5kM`
- Immutable deployment URL: `https://ennco-operacion-l4v7kzlcv-jorge13mainds-projects.vercel.app`
- Supabase project ref: `isnzaoifdjtwnugupidj`
- Supabase dashboard: `https://supabase.com/dashboard/project/isnzaoifdjtwnugupidj`
- Organization id: `e0000000-0000-4000-8000-000000000001`

## Live controls verified

- All 27 migrations through M027 are present in the managed database.
- The private `ennco-sensitive-documents` bucket exists with the managed storage policies.
- Annex A is ACTIVE with 3 companies, 12 aliases, 6 known domains and 6 domain suppressions.
- A single Teckel operator is configured with `SINGLE_TECKEL_OPERATOR` coverage.
- `global_kill_switch=true`.
- `external_send_allowed=false`.
- The health endpoint returns production, live evidence, outbound disabled and kill switch enabled.
- `/operacion` redirects unauthenticated traffic to `/ingreso`.
- `/ingreso` and `/ingreso/recuperar` return HTTP 200 with private no-store and noindex headers.
- No Google account setting was changed.
- No email, Apollo enrollment, LinkedIn action, WhatsApp message or campaign was sent.

## Verification executed

- `npm run verify:m24`: PASS.
- TypeScript: PASS.
- ESLint with zero warnings: PASS.
- Vitest: 56 files and 263 tests PASS.
- Next production build: PASS.
- Focused auth and security tests: 2 files and 8 tests PASS.
- Secret scanner: 585 files, 0 findings.
- Live Vercel deployment: READY and aliased to the production URL.

## Access activation status

The application now includes a password recovery route, a dedicated Control Room password flow, an auth callback and TOTP enrollment. The code, typecheck, lint, build and production HTTP routes are verified.

The Supabase Auth site URL and redirect allowlist were applied through an authenticated administrator session and verified in the managed dashboard on 2026-08-20:

- Site URL: `https://ennco-operacion.vercel.app`
- Redirect URL: `https://ennco-operacion.vercel.app/auth/callback`
- Managed dashboard confirmation: `Successfully added 1 URL`

The first human sign-in remains `EXTEND` until the authorized user completes the one-time recovery link, creates a Control Room-only password and verifies TOTP MFA. Existing database, portal and safety controls continue operating.

## Commercial HOLD

Outbound remains blocked until Apollo ownership, domains, mailboxes, DNS authentication, warmup, reply sync, inventory, canary evidence and explicit pilot approval are completed. The production activation in this report does not authorize or imply a commercial send.
