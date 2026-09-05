# Subscription Agreement

**GitHub Repo Manager — commercial subscription**
**Bola Labs**

## 1. What this is

The software is licensed to everyone under the [Apache License 2.0](../LICENSE).
That licence already grants you the right to run, modify, redistribute and
embed this code — commercially, privately, without asking and without paying.
**Nothing on this page takes any of that away, and nothing on it is required
to use the software.**

This is a **subscription agreement**: what you buy is capacity, service and
accountability on top of a licence you already have.

## 2. What money actually buys

| | Included in the Apache-2.0 licence | Included in a subscription |
|---|---|---|
| Run it, anywhere, forever | ✓ | ✓ |
| Modify it, keep changes private | ✓ | ✓ |
| Embed it in a proprietary product | ✓ | ✓ |
| Redistribute it | ✓ | ✓ |
| Higher monthly AI and API ceilings | — | ✓ |
| Hosted instance, run by us | — | ✓ |
| Support with a response commitment | — | ✓ |
| Compliance and audit deliverables | — | ✓ |
| Use of the RepoManager name and mark | — | by agreement — see [TRADEMARKS.md](../TRADEMARKS.md) |

Under the previous AGPL-3.0 licence, the thing being sold was an exemption
from copyleft. Apache-2.0 has no copyleft, so that exemption no longer exists
and is no longer sold. The tiers below are unchanged, because they never
described legal permissions in the first place — they described headroom.

## 3. License Tiers

A paid tier does **not** unlock product features. Nearly the entire product —
including the full AI surface, bulk operations, mirror sync, AI Deep Review,
Prompt Studio, PR Chat, PR slash commands, semantic search, DORA metrics and
unlimited-seat teams — ships on the free build with generous monthly
caps. What money buys is **headroom**, **more API keys**, and
**compliance/service deliverables**:

| Tier | What it adds over Free | Seats |
|------|------------------------|-------|
| **Pro** | AI queries: 10,000/month (Free: 1,000) · every per-feature AI cap lifted to unlimited (e.g. semantic search 375/month → unlimited, full migrations 5/month → unlimited) · API keys: 50 (Free: 25) · email support | As purchased |
| **Enterprise** | Everything in Pro + AI queries unlimited · audit log with export (Enterprise-only; `auditLog`/`auditExport` are `false` on Free and Pro) · API keys: 100 · priority support (e-mail, prioritised) · white-glove migration services | As purchased |

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
> - **Priority support** and **white-glove migration services** are manual,
>   contracted deliverables — they are not gated by a feature flag. Priority
>   support means the ticket is triaged ahead of the Community/Email queue;
>   it is not a contracted response-time guarantee.

## 4. Subscription Key

Each subscription is delivered as a cryptographically signed key that encodes
the tier, seat count and expiry. Validation is offline — the software never
phones home.

The key is an **entitlement**, not a permission: it tells your instance which
ceilings to apply. It is not what makes your use of the software lawful; the
Apache licence already did that, for everyone, unconditionally.

## 5. Restrictions

- Subscription keys are non-transferable and bound to the purchasing organization
- Reselling a key, or sharing one across organizations, ends the subscription
- No rights to the Bola Labs or RepoManager name or mark — those are reserved
  separately in [TRADEMARKS.md](../TRADEMARKS.md), and Apache-2.0 §6 says the
  same thing

Note what is **not** restricted, because it cannot be: redistributing the
software itself. Apache-2.0 permits that to anyone, subscriber or not.

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
- **Cancelling does not switch your key off.** It stops the renewal; the key
  already in your hands keeps working until the end of its own 1-month or
  12-month window. Self-hosted activation is offline by design — there is no
  phone-home, and Bola Labs cannot reach into your installation to disable a
  key you already hold. Since v4.11.0 an operator can revoke a key on an
  instance **they run**, which is a fraud/abuse control on hosted and
  self-managed deployments, not a remote kill switch over yours. See
  [`billing-and-licensing.md`](billing-and-licensing.md) for the full policy.
- Upon expiration the ceilings revert to the free tier. The software keeps
  working and stays yours to run — Apache-2.0 does not expire
- No data is lost upon expiration

## 7. Support

- **Pro:** Email support (bruno@bolalabs.pt)
- **Enterprise:** Priority support (e-mail, prioritised) and white-glove migration services — no contracted response-time guarantees

## 8. Contact

For subscription enquiries:
- Email: bruno@bolalabs.pt
- Web: <https://bolalabs.pt>

(There is no `/license` page yet. Until there is, this document is the terms,
and the email is the way in.)

## See also

- [`billing-and-licensing.md`](billing-and-licensing.md) — the Stripe → license
  key issuance flow and the AI spend-cap model.
- [`guides/stripe-setup.md`](guides/stripe-setup.md) — Stripe product, price ID,
  and webhook configuration.
