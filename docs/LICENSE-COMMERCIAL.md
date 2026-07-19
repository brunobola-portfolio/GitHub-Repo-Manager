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

| Tier | Features | Seats |
|------|----------|-------|
| **Pro** | Unlimited repos, 10,000 AI queries/month, semantic search, unlimited migrations (Azure DevOps + GitHub), unlimited teams, 50 API keys | As purchased |
| **Enterprise** | Everything in Pro + unlimited AI queries, audit logs (with export), unlimited teams, 100 API keys, priority support + SLA | As purchased |

> **Note.** Migration supports **Azure DevOps and GitHub** sources only — GitLab
> is not supported. **SSO / SAML is on the roadmap and not yet implemented**;
> only GitHub OAuth exists today, so it is never sold as a delivered feature.
> Teams are unlimited-seat on every tier (2026-07-18 rebalance).

## 4. License Key

Each commercial license is delivered as a cryptographically signed license key.
The key encodes the tier, seat count, and expiration date. No internet connection
is required for validation.

## 5. Restrictions

- License keys are non-transferable and bound to the purchasing organization
- Resale, sublicensing, or redistribution of the software under this license is prohibited
- The license does not grant rights to use Bola Labs trademarks

## 6. Term and Renewal

- Licenses are issued for 12-month terms (monthly or annual billing)
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
