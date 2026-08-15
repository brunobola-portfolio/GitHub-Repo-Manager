# Licence keys: how they are issued, and how the portal plugs in

Everything that mints a `grm_lic_*` key, and the three ways the marketing
portal (`bolalabs.pt`) can hand one to a customer.

Related: [Billing & licensing](../billing-and-licensing.md) (the full policy and
the Stripe webhook flow) · [Stripe setup](stripe-setup.md) ·
[IIS deployment](deploy-iis-windows.md).

---

## What a licence key is

An **Ed25519-signed JWT** with a `grm_lic_` prefix. The payload carries
`lid` (licence id), `org`, `email`, `tier`, `seats`, `iat`, `exp`
(`server/lib/license.js`).

Verification is **offline**. An install reads `keys/public.pem` — committed, and
public by definition — and checks the signature locally. There is no phone-home
and no activation server, which is what lets an air-gapped self-host work.

Two consequences worth stating plainly, because the portal copy will need them:

- **The private key is the whole product.** Whoever holds
  `keys/private.pem` can mint an Enterprise key for anyone. It is gitignored,
  lives only in the `LICENSE_PRIVATE_PEM` GitHub secret, and should exist in
  exactly one more place: your offline backup.
- **Revocation is per-instance.** An operator can revoke a key on an instance
  they run — via `POST /api/license/revocations` (admin-authenticated; there
  is no CLI for it, and `npm run admin:revoke` is a *user admin-flag* tool,
  not this) — and `verifyLicenseKey()` consults that list on every check. It
  is a local list, so it does not reach a customer's own self-hosted install.
  Never let the portal imply otherwise — that claim is
  [test-enforced](../../tests/build/license-claims.test.js).

---

## The three issuance paths

| # | Path | Who triggers | Portal work |
| - | ---- | ------------ | ----------- |
| A | **Stripe checkout** (self-service) | The customer | A link. Nothing else. |
| B | **`repository_dispatch`** (manual / enterprise) | Your backend | One server-side API call |
| C | Sign in the portal itself | — | **Don't.** See below. |

### A. Stripe checkout — already wired, recommended default

The app owns the whole flow: `POST /api/v1/billing/checkout` opens a Stripe
Checkout session → Stripe calls
`POST /api/v1/webhooks/stripe` → `issueLicenseForCheckout()` mints the key,
records it, and emails it via Resend
(`server/lib/license-issuer.js`). Monthly subscriptions get a fresh 1-month key
on every paid renewal invoice; annual gets 12 months.

**The portal needs no licensing code for this.** It links to the app's pricing
page and the app does the rest:

```text
https://repomanager.bolalabs.pt/#/pricing
```

Requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
`LICENSE_SIGNING_PRIVATE_KEY_PEM` on the app (production boot **aborts** if the
first is set without the other two).

### B. `repository_dispatch` — for keys you issue by hand

For enterprise deals, comps, partner keys, or replacing a lost key. The
`Mint License` workflow accepts a `repository_dispatch` of type
`mint-license` (`.github/workflows/mint-license.yml`):

```http
POST https://api.github.com/repos/<owner>/GitHub-Repo-Manager/dispatches
Authorization: Bearer <PAT>
Accept: application/vnd.github+json

{
  "event_type": "mint-license",
  "client_payload": {
    "tier":   "enterprise",
    "org":    "Acme, Inc.",
    "email":  "ops@acme.example",
    "seats":  "25",
    "months": "12",
    "notes":  "Signed 2026-08-08, PO 4471"
  }
}
```

Validation (`scripts/lib/minter.js` `validateInput`): `tier` must be `pro` or
`enterprise`; `org` and `email` are required (`email` is format-checked);
`seats` defaults to 1, `months` defaults to 12 and is capped at 24; `notes` is
audit-only and capped at 500 characters.

The workflow signs the key, emails it to `email` via Resend, and appends an
audit entry. **The key is never returned in the API response and never appears
in the workflow log** — it is masked at two levels before anything else runs.
Pass `"dry_run": true` to validate inputs and see the summary without minting,
emailing, or writing audit.

Three things to get right on the portal side:

1. **The PAT must belong to the allowlisted login.** The workflow gates
   `repository_dispatch` on `github.actor == (vars.MINT_ACTOR || 'brunobola')`.
   It deliberately does **not** compare against `github.repository_owner` —
   that is an Organization here, so it could never equal a user login and every
   dispatched mint was silently skipped. Any non-allowlisted token's dispatch is
   still accepted by GitHub with a `204` and then skipped.
2. **Server-side only.** A `repo`-scoped PAT in browser-reachable code is a
   full repository compromise. It belongs in the portal's backend
   environment, behind an admin-authenticated route.
3. **There is no delivery receipt in the response.** GitHub answers `204` for
   "dispatch accepted", not "key sent". Surface the workflow run link, or
   poll `GET /repos/{owner}/{repo}/actions/runs?event=repository_dispatch`.
   Failures also self-report: `scripts/mint-failure-notify.js` emails on
   `failure()`.

Required repository configuration:

| Kind | Name | Purpose |
| ---- | ---- | ------- |
| secret | `LICENSE_PRIVATE_PEM` | Ed25519 signing key |
| secret | `RESEND_API_KEY` | Key delivery + failure alerts |
| secret | `LICENSE_LOG_PAT` | Writes the audit entry |
| var | `AUDIT_REPO` | Where audit entries are committed |
| var | `LICENSE_KID` | Key id in the JWT header (default `k-default`) |
| var | `MINT_ACTOR` | Login allowed to trigger `repository_dispatch` (default `brunobola`) |

The same workflow is runnable from the Actions tab (`workflow_dispatch`) with
the same inputs — that is the zero-integration option if the portal never needs
to mint programmatically.

### C. Signing in the portal — don't

It would mean putting `LICENSE_PRIVATE_PEM` on the portal host, doubling the
number of places the one irreplaceable secret exists, and putting it on the
machine with the largest public attack surface. Path B gets the same result
with a revocable PAT instead. If the portal must own minting one day, rotate
to a new `kid` first so the old key can be retired independently.

---

## Generating the keypair (once)

```bash
npm run gen:keys    # node scripts/generate-keys.js
```

Writes `keys/private.pem` (gitignored) and `keys/public.pem` (committed —
offline verification needs it). The script refuses to overwrite an existing
private key, because regenerating invalidates **every licence ever issued**.

Put the private key in the `LICENSE_PRIVATE_PEM` GitHub secret and in an
offline backup. Do not keep it on any server.

> Not the same thing as `npm run gen:secrets`, which produces the four runtime
> secrets for a deployment's `.env` (see
> [deploy-iis-windows.md](deploy-iis-windows.md)). Different lifecycle:
> deployment secrets are rotatable, the licence signing key is not.

---

## What the portal must not claim

Pricing and feature claims are gated in this repo by
`tests/pricing-feature-parity.test.js` and `tests/build/readme-honesty.test.js`,
but **the portal is outside that fence** — nothing here can fail its build. Keep
these straight by hand:

- **Free is not a trial.** The full AI surface, every Work Board tab and
  unlimited teams are on Free, with monthly caps. Paid tiers sell headroom,
  support and licence terms.
- **BYOK is permanent.** Every tier uses the customer's own provider key.
  Do not advertise managed inference, included tokens, or "AI credits".
- **Self-hosting is free forever** under Apache-2.0.
- **No seat enforcement.** `seats` is recorded in the licence payload and is
  not enforced in code. Do not sell it as a technical limit.
- **Not SOC 2 certified**, no SAML SSO, no PostgreSQL support — all three are
  explicitly forbidden claims in the README gate, and the portal should
  inherit that list.

When in doubt, mirror the app's own pricing page rather than restating it: it
is the surface the parity test actually checks.

---

## Briefing the portal's own agent

The portal is a separate repository, so nothing in this repo can enforce its
copy. Give whoever (or whatever) works on it these three facts up front,
because each one is a mistake that looks reasonable:

1. **Link, don't reimplement.** The app owns checkout, licence delivery and
   the pricing page. The portal's job is a CTA to
   `https://repomanager.bolalabs.pt` (and `/#/pricing` for the plan table).
   Any licensing logic on the portal is duplicated state that will drift.
2. **The signing key never leaves GitHub secrets.** If the portal needs to
   mint, it dispatches to the workflow (path B above) with a server-side PAT
   owned by the repository owner. It does not sign, and it does not receive
   the key — delivery is by email, from the workflow.
3. **The honest-claims list above is binding.** Free-first, BYOK-permanent,
   self-hosting free forever, no seat enforcement, not SOC 2 certified. This
   repo's tests enforce those on the app's own surfaces and cannot see the
   portal, so they have to be carried by hand.
