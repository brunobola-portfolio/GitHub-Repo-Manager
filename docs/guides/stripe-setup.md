# Stripe Billing Setup Guide

## Prerequisites

- Stripe account at [dashboard.stripe.com](https://dashboard.stripe.com)
- Products already created (see below)

## Products

Create the **Pro** product in Stripe Dashboard > Product catalog:

| Product | Price                                                                       |
|---------|-----------------------------------------------------------------------------|
| **Pro** | $19/month, or $180/year (the pricing page shows yearly as 20% off monthly)  |

Enterprise is **Contact Sales** on every pricing surface — it has no self-serve
checkout button. Only create an Enterprise product if you intend to send
manually-generated checkout links; otherwise leave its price IDs unset.

Copy each product's **Product ID** (starts with `prod_...`) — you'll need them for reference.

## Step 1: Get Price IDs

1. Go to **Product catalog** in Stripe Dashboard
2. Click on the product
3. Copy the **Price ID** (starts with `price_...`) for each price you created
4. You need the monthly ID; add the yearly ID too if you want the pricing page's
   yearly toggle to work — `/api/v1/billing/config` reports
   `yearlyBillingAvailable: false` until `STRIPE_PRICE_PRO_YEARLY` is set, and a
   yearly checkout without it returns a 400 rather than silently charging monthly.

## Step 2: Create Webhook Endpoint

1. Go to **Developers** > **Webhooks** > **Add endpoint**
2. **Endpoint URL:** `https://YOUR-DOMAIN.com/api/v1/webhooks/stripe`
3. **Events to listen to** (click "Select events"):
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.paid`
4. Click **Add endpoint**
5. Copy the **Signing secret** (`whsec_...`)

### Local Testing (without a domain)

Install [Stripe CLI](https://docs.stripe.com/stripe-cli) and run:

```bash
stripe listen --forward-to localhost:3001/api/v1/webhooks/stripe
```

This outputs a temporary `whsec_...` key for local testing.

## Step 3: Configure .env

Add these to your `.env` file:

```env
STRIPE_SECRET_KEY=sk_live_...             # From Developers > API keys
STRIPE_WEBHOOK_SECRET=whsec_...           # From the webhook endpoint
STRIPE_PRICE_PRO_MONTHLY=price_...        # Pro monthly price ID
STRIPE_PRICE_PRO_YEARLY=price_...         # Pro yearly price ID (enables the yearly toggle)
STRIPE_PRICE_ENTERPRISE_MONTHLY=price_... # Optional — Enterprise is Contact Sales
STRIPE_PRICE_ENTERPRISE_YEARLY=price_...  # Optional
```

> **Running in Docker?** `docker-compose.yml` passes an explicit allowlist of
> variables into the container, not your whole `.env`. Confirm the `STRIPE_*`
> entries are present in the `environment:` block — a missing price ID makes
> checkout return `Price not configured` after the customer has already
> committed to buying.

## Step 4: Restart & Test

1. Restart the server: `npm run dev:all`
2. Navigate to Pricing page
3. Click "Upgrade to Pro" on the Pro card
4. Should redirect to Stripe Checkout
5. Use test card `4242 4242 4242 4242` (any future expiry, any CVC)
6. After payment, check Settings > Billing — tier should update

## How It Works

```
User clicks "Get Pro"
  → Frontend POST /api/v1/billing/checkout { tier: "pro" }
  → Backend creates Stripe Checkout Session
  → User redirected to Stripe payment page
  → User completes payment
  → Stripe sends webhook to /api/v1/webhooks/stripe
  → Backend updates user_subscriptions table
  → User sees Pro tier in Settings > Billing
```

## Security Notes

- **NEVER** commit `.env` or Stripe keys to git
- **NEVER** share `sk_live_...` keys in chats, issues, or PRs
- If a key is leaked, rotate it immediately in Stripe Dashboard > Developers > API keys
- Use `sk_test_...` keys for development, `sk_live_...` only in production

## See also

- [`../billing-and-licensing.md`](../billing-and-licensing.md) — how a completed
  Stripe checkout mints and emails the signed license key.
- [`../LICENSE-COMMERCIAL.md`](../LICENSE-COMMERCIAL.md) — the commercial license
  terms and per-tier entitlements.
