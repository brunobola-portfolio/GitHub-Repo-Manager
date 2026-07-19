# Stripe Billing Setup Guide

## Prerequisites

- Stripe account at [dashboard.stripe.com](https://dashboard.stripe.com)
- Products already created (see below)

## Products

Create two products in Stripe Dashboard > Product catalog:

| Product | Monthly Price |
|---------|---------------|
| **Pro** | $19/month |
| **Enterprise** | $49/month |

Copy each product's **Product ID** (starts with `prod_...`) — you'll need them for reference.

## Step 1: Get Price IDs

1. Go to **Product catalog** in Stripe Dashboard
2. Click on each product
3. Copy the **Price ID** (starts with `price_...`) for the monthly price
4. You need both `price_...` IDs for the `.env` file

## Step 2: Create Webhook Endpoint

1. Go to **Developers** > **Webhooks** > **Add endpoint**
2. **Endpoint URL:** `https://YOUR-DOMAIN.com/api/v1/stripe/webhooks`
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
stripe listen --forward-to localhost:3001/api/v1/stripe/webhooks
```

This outputs a temporary `whsec_...` key for local testing.

## Step 3: Configure .env

Add these to your `.env` file:

```env
STRIPE_SECRET_KEY=sk_live_...          # From Developers > API keys
STRIPE_WEBHOOK_SECRET=whsec_...        # From the webhook endpoint
STRIPE_PRICE_PRO_MONTHLY=price_...     # Pro product monthly price ID
STRIPE_PRICE_ENTERPRISE_MONTHLY=price_... # Enterprise product monthly price ID
```

## Step 4: Restart & Test

1. Restart the server: `npm run dev:all`
2. Navigate to Pricing page
3. Click "Start 14-day free trial" on the Pro card
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
  → Stripe sends webhook to /api/v1/stripe/webhooks
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
