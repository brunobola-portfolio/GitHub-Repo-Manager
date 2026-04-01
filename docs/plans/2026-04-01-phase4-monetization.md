# Phase 4: Monetization & Billing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Stripe for subscription billing. Implement usage metering, pricing page, checkout flow, customer portal, and webhook handling for payment events.

**Spec:** `docs/specs/2026-04-01-platform-transformation-spec.md`

**Tech Stack:** Stripe (stripe npm package), Express 5, React 19.

**Prerequisites:** Phase 3 complete (tier system, feature gating).

---

## Parallelism Map

Task 1 must be done first (Stripe setup).
Tasks 2, 3 are independent — run in parallel (after Task 1).
Task 4 depends on Tasks 2 + 3.
Task 5 depends on Task 4.
Task 6 depends on Task 5.

---

## Task 1: Stripe Setup & Configuration

**Files:**
- Modify: `package.json` (add stripe)
- Create: `server/lib/stripe.js`
- Modify: `server/config.js` (add Stripe env vars)
- Modify: `.env.example`

- [ ] **Step 1.1: Install Stripe**

  ```bash
  npm install stripe
  ```

- [ ] **Step 1.2: Add Stripe config**

  Read `server/config.js`. Add:
  ```js
  // Stripe (optional, enables billing)
  stripeSecretKey: z.string().optional(),
  stripeWebhookSecret: z.string().optional(),
  stripePriceProMonthly: z.string().optional(),
  stripePriceEnterpriseMonthly: z.string().optional(),
  ```

- [ ] **Step 1.3: Create Stripe client module**

  Create `server/lib/stripe.js`:
  ```js
  import Stripe from 'stripe';
  import { config } from '../config.js';

  let stripe = null;

  export function getStripe() {
    if (!stripe && config.stripeSecretKey) {
      stripe = new Stripe(config.stripeSecretKey, {
        apiVersion: '2024-12-18.acacia',
      });
    }
    return stripe;
  }

  export function isStripeEnabled() {
    return !!config.stripeSecretKey;
  }
  ```

- [ ] **Step 1.4: Configure Stripe products in dashboard**

  In Stripe dashboard, create:

  **Product: GitHub Repo Manager Pro**
  - Price: $19/month (recurring)
  - Features metadata: `tier=pro`

  **Product: GitHub Repo Manager Enterprise**
  - Price: $99/month per seat (recurring, metered)
  - Features metadata: `tier=enterprise`

  Note the price IDs for environment variables.

- [ ] **Step 1.5: Update .env.example**

  ```env
  # === Optional: Billing (Stripe) ===
  # STRIPE_SECRET_KEY=sk_test_...
  # STRIPE_WEBHOOK_SECRET=whsec_...
  # STRIPE_PRICE_PRO_MONTHLY=price_...
  # STRIPE_PRICE_ENTERPRISE_MONTHLY=price_...
  ```

- [ ] **Step 1.6: Commit**

  ```
  feat(billing): add Stripe client configuration
  ```

---

## Task 2: Checkout & Subscription Management

**Depends on:** Task 1

**Files:**
- Create: `server/routes/billing.js`
- Modify: `server/index.js` (register billing routes)

- [ ] **Step 2.1: Create billing routes**

  Create `server/routes/billing.js`:

  **`POST /api/v1/billing/checkout`** — Create Stripe Checkout session
  ```js
  // Input: { tier: 'pro' | 'enterprise', seats?: number }
  // Creates Stripe customer if not exists
  // Creates Checkout session with:
  //   - success_url: FRONTEND_URL/settings?billing=success
  //   - cancel_url: FRONTEND_URL/pricing
  //   - metadata: { userId, tier }
  // Returns: { url: checkout_session.url }
  ```

  **`POST /api/v1/billing/portal`** — Customer portal session
  ```js
  // Redirects to Stripe Customer Portal
  // User can manage subscription, update payment, cancel
  // Returns: { url: portal_session.url }
  ```

  **`GET /api/v1/billing/subscription`** — Get current subscription
  ```js
  // Returns: { tier, status, currentPeriodEnd, cancelAtPeriodEnd }
  ```

- [ ] **Step 2.2: Create/link Stripe customer on first checkout**

  When a user initiates checkout:
  1. Check if user has `stripe_customer_id` in `user_subscriptions`
  2. If not, create Stripe customer with GitHub email
  3. Store `stripe_customer_id` in database
  4. Create Checkout session linked to customer

- [ ] **Step 2.3: Register billing routes**

  Read `server/index.js` (or `server/routes/v1/index.js`). Add:
  ```js
  import billingRoutes from '../billing.js';
  router.use('/billing', requireAuth, billingRoutes);
  ```

- [ ] **Step 2.4: Commit**

  ```
  feat(billing): add checkout, portal, and subscription status endpoints
  ```

---

## Task 3: Stripe Webhooks

**Depends on:** Task 1

**Files:**
- Create: `server/routes/stripe-webhooks.js`
- Modify: `server/index.js` (mount webhook route BEFORE json parser)

- [ ] **Step 3.1: Create webhook handler**

  Create `server/routes/stripe-webhooks.js`:

  **IMPORTANT:** Webhook route must use `express.raw()` body parser, NOT `express.json()`. Mount it before the global JSON parser in `server/index.js`.

  Handle events:
  ```js
  switch (event.type) {
    case 'checkout.session.completed':
      // User completed checkout
      // Extract userId from metadata
      // Update user_subscriptions: tier, stripe_subscription_id, status='active'
      break;

    case 'customer.subscription.updated':
      // Subscription changed (upgrade, downgrade, renewal)
      // Update tier, period dates, status
      break;

    case 'customer.subscription.deleted':
      // Subscription cancelled
      // Downgrade to free tier
      // Set status='cancelled'
      break;

    case 'invoice.payment_failed':
      // Payment failed
      // Set status='past_due'
      // Email user (optional, Stripe does this too)
      break;

    case 'invoice.paid':
      // Successful payment
      // Set status='active', update period dates
      break;
  }
  ```

- [ ] **Step 3.2: Verify webhook signatures**

  ```js
  const sig = req.headers['stripe-signature'];
  const event = stripe.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
  ```

  CRITICAL: This prevents spoofed webhook calls.

- [ ] **Step 3.3: Mount webhook route before JSON parser**

  In `server/index.js`, mount the webhook route with raw body parser BEFORE `express.json()`:

  ```js
  // Stripe webhooks need raw body
  app.post('/api/v1/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    stripeWebhookHandler
  );

  // Then global JSON parser
  app.use(express.json({ limit: '10kb' }));
  ```

- [ ] **Step 3.4: Test with Stripe CLI**

  ```bash
  stripe listen --forward-to localhost:3001/api/v1/webhooks/stripe
  stripe trigger checkout.session.completed
  ```

- [ ] **Step 3.5: Commit**

  ```
  feat(billing): add Stripe webhook handler for subscription lifecycle
  ```

---

## Task 4: Usage Metering

**Depends on:** Tasks 2 + 3

**Goal:** Track AI query usage per user per billing period. Enforce limits based on tier.

**Files:**
- Create: `server/lib/usage-meter.js`
- Modify: `server/db.js` (add usage_metrics table)
- Modify: `server/routes/ai.js` (check usage before AI calls)
- Create: `server/routes/usage.js`

- [ ] **Step 4.1: Add usage_metrics table**

  Add migration `006-usage-metrics.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS usage_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    metric_type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX idx_usage_unique ON usage_metrics(user_id, metric_type, period_start);
  ```

  Metric types:
  - `ai_queries` — AI chat, analyze, suggestions
  - `ai_readme_gen` — README generation
  - `ai_quality_reports` — Quality reports
  - `repos_managed` — Total repos in dashboard
  - `migration_runs` — Migration executions

- [ ] **Step 4.2: Create usage meter**

  Create `server/lib/usage-meter.js`:
  ```js
  export async function incrementUsage(userId, metricType) {
    // Get current billing period (start of month to end of month)
    // Upsert usage_metrics: increment count
    // Return { current, limit, remaining }
  }

  export async function checkUsageLimit(userId, metricType) {
    const tier = await getUserTier(userId);
    const limits = TIER_LIMITS[tier];
    const current = await getCurrentUsage(userId, metricType);
    return {
      allowed: current < limits[metricType],
      current,
      limit: limits[metricType],
      remaining: Math.max(0, limits[metricType] - current),
    };
  }
  ```

- [ ] **Step 4.3: Add usage checks to AI routes**

  Read `server/routes/ai.js`. Before each AI operation:
  ```js
  const usage = await checkUsageLimit(req.tenantId, 'ai_queries');
  if (!usage.allowed) {
    return res.status(429).json({
      error: 'usage_limit_exceeded',
      message: `You've used ${usage.current}/${usage.limit} AI queries this month`,
      upgradeUrl: '/pricing',
    });
  }
  // ... proceed with AI operation
  await incrementUsage(req.tenantId, 'ai_queries');
  ```

- [ ] **Step 4.4: Create usage dashboard endpoint**

  Create `server/routes/usage.js`:
  - `GET /api/v1/usage` — Returns current usage across all metrics
  - `GET /api/v1/usage/history` — Monthly usage history (chart data)

- [ ] **Step 4.5: Commit**

  ```
  feat(billing): add usage metering with tier-based limits
  ```

---

## Task 5: Pricing Page

**Depends on:** Task 4

**Files:**
- Create: `src/components/Pricing/PricingPage.jsx`
- Create: `src/components/Pricing/PricingCard.jsx`
- Create: `src/components/Pricing/FeatureComparison.jsx`
- Modify: `src/App.jsx` (add pricing route/view)

- [ ] **Step 5.1: Create PricingCard component**

  Create `src/components/Pricing/PricingCard.jsx`:
  - Glassmorphism card matching existing design system
  - Highlighted "Popular" badge on Pro tier
  - Price with monthly/yearly toggle
  - Feature list with checkmarks/X marks
  - CTA button: "Get Started" (free), "Upgrade to Pro", "Contact Sales"
  - Current plan indicator if user is logged in

- [ ] **Step 5.2: Create FeatureComparison component**

  Create `src/components/Pricing/FeatureComparison.jsx`:
  - Detailed feature comparison table
  - Categories: Repository Management, AI Features, Migration, Teams, Security
  - Check/X/number for each tier
  - Sticky header with tier names

- [ ] **Step 5.3: Create PricingPage**

  Create `src/components/Pricing/PricingPage.jsx`:
  - Hero: "Simple, transparent pricing"
  - 3-column pricing cards (Free / Pro / Enterprise)
  - Feature comparison table below
  - FAQ section at bottom
  - CTA: "Start for free, upgrade when you need"
  - Framer Motion animations on scroll

- [ ] **Step 5.4: Add pricing view to App.jsx**

  Read `src/App.jsx`. Add a way to display the pricing page:
  - Can be a modal or a full view depending on current routing approach
  - Accessible from header "Upgrade" button (for free users)
  - Accessible from Settings

- [ ] **Step 5.5: Integrate checkout flow**

  When user clicks "Upgrade to Pro" or "Upgrade to Enterprise":
  1. Call `POST /api/v1/billing/checkout` with tier
  2. Redirect to returned Stripe Checkout URL
  3. On success redirect, show success toast
  4. Refresh user tier in frontend state

- [ ] **Step 5.6: Commit**

  ```
  feat(pricing): add pricing page with Stripe checkout integration
  ```

---

## Task 6: Settings Billing Section

**Depends on:** Task 5

**Files:**
- Create: `src/components/Settings/BillingSection.jsx`
- Create: `src/components/Settings/UsageSection.jsx`

- [ ] **Step 6.1: Create BillingSection**

  Create `src/components/Settings/BillingSection.jsx`:
  - Current plan display (tier, status, renewal date)
  - "Manage Subscription" button (opens Stripe Customer Portal)
  - "Change Plan" button (opens pricing page)
  - Payment method display (last 4 digits of card)
  - Billing history link

- [ ] **Step 6.2: Create UsageSection**

  Create `src/components/Settings/UsageSection.jsx`:
  - Usage bars for each metered feature:
    - AI Queries: 45/50 used
    - Repos: 12/20 managed
  - Progress bar with color (green → yellow → red)
  - "Resets on [date]" indicator
  - Link to upgrade if approaching limit

- [ ] **Step 6.3: Integrate into Settings modal**

  Read the Settings modal component. Add Billing and Usage tabs/sections.

- [ ] **Step 6.4: Commit**

  ```
  feat(settings): add billing management and usage dashboard
  ```

---

## Completion Checklist

- [ ] Stripe client configured
- [ ] Checkout session creation
- [ ] Stripe Customer Portal integration
- [ ] Webhook handler for all subscription events
- [ ] Usage metering (AI queries, repos, migrations)
- [ ] Tier-based usage limits enforced
- [ ] Pricing page with feature comparison
- [ ] Stripe Checkout integration in frontend
- [ ] Billing section in Settings
- [ ] Usage dashboard in Settings
- [ ] All tests pass
- [ ] Stripe CLI webhook testing verified
