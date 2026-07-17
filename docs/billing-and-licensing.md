# Billing and Licensing

## License delivery — Stripe → license key flow

When a user completes a Stripe checkout, the server automatically mints a signed Ed25519 license key and emails it to the subscriber.

### Flow overview

```
Stripe checkout completed
        │
        ▼
stripeWebhookHandler (stripe-webhooks.js)
        │
        ├─ reconcileTierFromPrice()  ← cross-checks price metadata vs session metadata
        │
        ├─ INSERT/UPDATE user_subscriptions
        │
        └─ issueLicenseForCheckout() (lib/license-issuer.js)
                │
                ├─ Check issued_licenses WHERE stripe_session_id = ?  ← idempotency guard
                │
                ├─ generateLicenseKey()  ← signed Ed25519 JWT (lib/license.js)
                │
                ├─ INSERT INTO issued_licenses
                │
                └─ sendEmail()  ← delivery via EMAIL_PROVIDER adapter
```

### Idempotency

The `issued_licenses` table has a `UNIQUE (stripe_session_id)` constraint. If Stripe retries a webhook (up to 5 times), `issueLicenseForCheckout` detects the existing row and returns the already-issued key without sending a second email.

### Failure handling

The license/email pipeline runs inside a `try/catch` in the webhook handler. Any failure is logged but does **not** cause the handler to return a non-200 status. Stripe must always receive 200 — a non-200 triggers retries and could cause duplicate subscription writes.

If email delivery fails:
- The license key is still persisted in `issued_licenses` with `email_delivered = 0`.
- The error is logged at `warn` level.
- No retry is attempted automatically; operators can inspect `issued_licenses` and re-send manually.

### issued_licenses table

| Column | Description |
|---|---|
| `id` | Auto-increment primary key |
| `user_id` | FK → `users.id` (SET NULL on user deletion) |
| `stripe_subscription_id` | Stripe subscription ID |
| `stripe_session_id` | Stripe checkout session ID (unique — idempotency key) |
| `tier` | `'pro'` or `'enterprise'` |
| `license_key` | Full signed license key string (`grm_lic_...`) |
| `expires_at` | Expiry timestamp (12 months from issue) |
| `issued_at` | Row creation timestamp |
| `email_delivered` | `1` if the email was sent successfully, `0` otherwise |
| `email_delivered_at` | Timestamp of successful delivery |

### Required environment variables

| Variable | Description |
|---|---|
| `LICENSE_SIGNING_PRIVATE_KEY_PEM` | Ed25519 private key in PKCS#8 PEM format. Generate with `generateKeyPair()` from `server/lib/license.js`. |
| `EMAIL_PROVIDER` | `resend` for live delivery; `console` (default) for dev logging. |
| `RESEND_API_KEY` | Required when `EMAIL_PROVIDER=resend`. |
| `EMAIL_FROM` | Verified sender address for Resend. |

If `LICENSE_SIGNING_PRIVATE_KEY_PEM` is absent:
- **Development**: logs a warning and skips license generation. The webhook still returns 200.
- **Production**: logs a fatal-level message and returns `{ licenseKey: null, emailDelivered: false }`. The webhook still returns 200 to Stripe.

### Generating the signing key pair

```js
import { generateKeyPair } from './server/lib/license.js'
const { privateKey, publicKey } = await generateKeyPair()
// Store privateKey in LICENSE_SIGNING_PRIVATE_KEY_PEM
// Store publicKey wherever license validation happens
```

## AI monthly $ spend cap

`server/lib/ai-spend-cap.js` enforces an optional monthly per-user dollar
ceiling on AI spend, on top of the count-based quotas in `feature-flags.js`.

**Self-hosted AGPL deployments stay disabled by default** — the cap only
activates if an operator explicitly sets one of the env overrides below.
There is no bill-shock risk from running the open-source project as-is.

Hosted operation resolves a tier-aware cap in this order:

1. Tier-specific env override — `AI_SPEND_CAP_CENTS_FREE` /
   `AI_SPEND_CAP_CENTS_PRO` / `AI_SPEND_CAP_CENTS_ENTERPRISE` (cents).
2. Legacy flat override — `AI_SPEND_CAP_CENTS` (cents), a one-number
   escape hatch that applies to every tier.
3. The tier's default in `TIER_FEATURES.<tier>.aiSpendCapCents` (ships as
   `0`/disabled for every tier out of the box).
4. `0` (disabled).

See `.env.example` for the recommended hosted values (illustrative, not
calibrated to real provider costs).

### Activating a license (user instructions)

1. Open GitHub Repo Manager.
2. Go to **Settings → License & Plan → Activate**.
3. Paste the `grm_lic_...` key and click **Activate**.
4. Pro/Enterprise features unlock immediately.
