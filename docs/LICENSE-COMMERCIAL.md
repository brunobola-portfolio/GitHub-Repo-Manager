# Commercial License Agreement

**GitHub Repo Manager - Commercial License**
**Bola Labs**

## 1. Grant of License

Subject to the terms of this agreement, Bola Labs grants the licensee a
non-exclusive, non-transferable license to use GitHub Repo Manager
without the obligations of the GNU Affero General Public License v3.

## 2. Scope

This commercial license covers:

- **Self-hosted deployments** for internal business use
- **On-premises installations** within the licensee's infrastructure
- **Modifications** for internal use (no obligation to publish source)
- **Integration** into proprietary systems without AGPL copyleft requirements

## 3. License Tiers

A paid tier does **not** unlock product features. Nearly the entire product —
including the full AI surface, bulk operations, mirror sync, AI Deep Review,
Prompt Studio, PR Chat, PR slash commands, semantic search, DORA metrics and
unlimited-seat teams — ships on the free AGPL build with generous monthly
caps. What money buys is **headroom**, **more API keys**, and
**compliance/service deliverables**:

| Tier | What it adds over Free | Seats |
|------|------------------------|-------|
| **Pro** | AI queries: 10,000/month (Free: 1,000) · every per-feature AI cap lifted to unlimited (e.g. semantic search 375/month → unlimited, full migrations 5/month → unlimited) · API keys: 50 (Free: 25) · email support | As purchased |
| **Enterprise** | Everything in Pro + AI queries unlimited · audit log with export (Enterprise-only; `auditLog`/`auditExport` are `false` on Free and Pro) · API keys: 100 · priority support with SLA · white-glove migration services | As purchased |

> **Note.** The exact numbers above are a rendering of
> [`server/lib/feature-flags.js`](../server/lib/feature-flags.js)
> (`TIER_FEATURES`), which is the source of truth and is CI-checked against
> every pricing surface — cross-check there before quoting a cap.
>
> - **Semantic search and unlimited-seat teams are Free features**, not Pro
>   value. Teams have been unlimited-seat on every tier since the 2026-07-18
>   rebalance; Pro only removes semantic search's monthly count cap.
> - Migration supports **Azure DevOps and GitHub** sources only — GitLab
>   is not supported. Azure DevOps **Server (on-premise)** is supported on
>   every tier via the host allowlist, not sold as an Enterprise upgrade.
> - **SSO / SAML is on the roadmap and not yet implemented**; only GitHub
>   OAuth exists today, so it is never sold as a delivered feature.
> - **BYOK is permanent.** No tier includes managed inference or model
>   credits. You configure your own provider key (Anthropic, OpenAI, Gemini,
>   OpenRouter, or a local model) and are billed by that provider directly;
>   Bola Labs never proxies or resells inference.
> - **Priority Support + SLA** and **white-glove migration services** are
>   manual, contracted deliverables — they are not gated by a feature flag.

## 4. License Key

Each commercial license is delivered as a cryptographically signed license key.
The key encodes the tier, seat count, and expiration date. No internet connection
is required for validation.

## 5. Restrictions

- License keys are non-transferable and bound to the purchasing organization
- Resale, sublicensing, or redistribution of the software under this license is prohibited
- The license does not grant rights to use Bola Labs trademarks

## 6. Term and Renewal

- **The license term matches the billing period you paid for**, never a flat
  12 months. A monthly subscription is issued a **1-month** key; an annual
  subscription is issued a **12-month** key
  ([`server/routes/stripe-webhooks.js`](../server/routes/stripe-webhooks.js)
  derives `licenseMonths` from `session.metadata.billingPeriod`).
- **Monthly keys renew automatically.** Each paid renewal invoice mints and
  emails a fresh 1-month key, so an active monthly subscriber's key is
  replaced every cycle rather than expiring. Annual keys are not reissued
  mid-year.
- **Keys are not remotely revocable.** Cancelling stops the renewal — it does
  not invalidate the key already in your hands, which keeps working until the
  end of its own 1-month or 12-month window. Self-hosted activation is offline
  by design, so there is no runtime revocation check. See
  [`billing-and-licensing.md`](billing-and-licensing.md) for the full policy.
- Upon expiration, the software reverts to AGPL v3 community features (free tier)
- No data is lost upon expiration

## 7. Support

- **Pro:** Email support (bruno@bolalabs.pt)
- **Enterprise:** Priority support with SLA guarantees

## 8. Contact

For licensing inquiries:
- Email: bruno@bolalabs.pt
- Website: https://bolalabs.pt/license

## See also

- [`billing-and-licensing.md`](billing-and-licensing.md) — the Stripe → license
  key issuance flow and the AI spend-cap model.
- [`guides/stripe-setup.md`](guides/stripe-setup.md) — Stripe product, price ID,
  and webhook configuration.
