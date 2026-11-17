# server/AGENTS.md — backend rules

Applies to everything under `server/`. The root `AGENTS.md` still applies.
Tests for this directory live in `server/__tests__/`.

## Data

- SQLite only (better-sqlite3), parameterized queries always, never string
  interpolation. PostgreSQL is intentionally unsupported and rejected at boot.
- Schema changes are migrations in `server/lib/db-migrations.js`, never ad-hoc
  `CREATE TABLE` in a route.

## Security

- Writes to a user's repository go preview-first through `commitOrOpenPR()`
  (`server/lib/ai-features/community-health-fix.js`). Never auto-commit, never
  add a new write primitive. Derive and validate file paths on the server;
  never trust a path the client echoes back.
- Session cookies: `httpOnly`, `sameSite: 'lax'`, `secure` in production.
- New `requireScope('ai')` routes are added to `AI_GENERATION_ROUTE_PATHS`
  (exact paths) or `AI_GENERATION_ROUTE_PATTERNS` (parameterised, with method)
  in `server/middleware/api-key-auth.js`. Parity tests enforce both.
- Never log or persist a secret outside its own table: licence keys live only
  in `issued_licenses`, and the failed-email queue stores a reference that is
  rebuilt at send time (`licenseEmailDeadLetterHandler`).

## AI routes

- Every generation is metered: `guardedGenerate` (spend cap, cost recording,
  audit) or the documented `checkAISpendCap` / `recordAISpend` pair.
  Unmetered provider calls are a regression class with dedicated tests.
- Quotas: `reserveAIQuota` (charged on a <400 response) or `holdAIQuota` +
  `commit()` for streams, from `server/routes/ai-quota.js`. Never
  `checkUsageLimit` followed by `incrementUsage`: bursts overspend the cap.
- The spend cap protects the operator's shared key only.
  `isServerKeyProvider()` gates the spend functions; a user on their own key
  is never metered against the operator's ceiling. Monthly feature quotas
  apply whoever's key is used.

## Email

- Sender, Reply-To and the support line come from
  `server/lib/email-identity.js` (`resolveSender`, `supportFooterParts`). Never
  hardcode an address. bolalabs.pt defaults apply only when `EMAIL_FROM` is on
  that domain; any other install gets only what its operator configured.
- Every mail body goes through `renderEmail` (`server/lib/email-layout.js`),
  which builds HTML and plain text from one spec and escapes every segment.
  Never write a mail's HTML by hand. Lime is a fill only; no images.
- Escape subjects with `headerSafe`.
- `sendEmail` resolves `{ ok: false }` on a provider 4xx; it does not throw.
  Check `ok` before recording a delivery.

## Billing and licences

- Stripe events: `server/routes/stripe-webhooks.js`, idempotent per event. On
  a failure that must be retried, call `forgetIdempotency()` and return 5xx.
- Keys are `grm_lic_` + an EdDSA JWT (`server/lib/license.js`). The BolaLabs
  backoffice decodes the `tier`, `seats`, `org` and `exp` claims: renaming or
  removing one breaks it silently.
