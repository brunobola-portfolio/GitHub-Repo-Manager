import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getStripe, isStripeEnabled } from '../lib/stripe.js';
import { config } from '../config.js';
import { z } from 'zod';
import logger from '../lib/logger.js';

const router = Router();

// Statuses that mean "this user is already on a paying subscription".
// 'past_due' counts: the subscription still exists in Stripe and will retry,
// so opening a second checkout would double-bill rather than fix anything.
const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due', 'incomplete']);

// Refunds and chargebacks suspend access WITHOUT cancelling the Stripe
// subscription (see the charge.refunded handler in stripe-webhooks.js), so the
// customer sees a Free UI over a subscription that is still billing them. They
// must be blocked from checkout for the same double-charge reason as the set
// above — but telling them they "already have an active subscription" would be
// a lie, hence the separate message. Only customer.subscription.deleted, which
// sets 'cancelled', frees a user to check out again.
const HELD_SUB_STATUSES = new Set(['refunded', 'disputed']);

const checkoutSchema = z.object({
    tier: z.enum(['pro', 'enterprise']),
    // Billing cadence. Defaults to monthly so older clients (and any caller
    // that omits it) keep the previous behaviour. Yearly is only honoured when
    // a matching yearly price ID is configured (see resolvePriceId).
    billingPeriod: z.enum(['monthly', 'yearly']).default('monthly'),
});

// Map (tier, billingPeriod) → the configured Stripe price ID. Returns null when
// that combination has no price configured (e.g. yearly requested but
// STRIPE_PRICE_*_YEARLY is unset), which the caller turns into a 400 so we
// never silently fall back to the monthly price and mis-charge the buyer.
function resolvePriceId(tier, billingPeriod) {
    if (tier === 'pro') {
        return billingPeriod === 'yearly' ? config.stripePriceProYearly : config.stripePriceProMonthly;
    }
    return billingPeriod === 'yearly' ? config.stripePriceEnterpriseYearly : config.stripePriceEnterpriseMonthly;
}

// Whether yearly checkout is actually wired. The pricing page's monthly/yearly
// toggle is Pro-driven (Enterprise is Contact-Sales), so yearly is "available"
// only when Stripe is enabled AND a real Pro yearly price ID is configured.
function isYearlyBillingAvailable() {
    return isStripeEnabled() && !!config.stripePriceProYearly;
}

function requireStripe(req, res, next) {
    if (!isStripeEnabled()) {
        return res.status(503).json({ error: 'Billing is not configured' });
    }
    next();
}

// Resolved Stripe prices, cached. Operators configure price IDs, not amounts —
// the amount lives in Stripe — so this is the only honest source for what the
// pricing page should display. Without it the page showed a hardcoded $19
// while the checkout charged whatever the operator's price actually is.
//
// Cached because the pricing page hits this on every mount and prices change
// about never; a stale window of minutes cannot mis-charge anyone, since the
// checkout always uses the price ID rather than the number shown.
const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;
let priceCache = { at: 0, value: null };

/**
 * Drop the cached prices. Mirrors `invalidate()` in lib/ai-health-probe.js —
 * the same affordance for the same reason: a cached lookup that survives
 * across tests makes each one depend on the order it ran in.
 */
export function invalidatePriceCache() {
    priceCache = { at: 0, value: null };
}

async function resolvePrices() {
    if (!isStripeEnabled()) return {};
    if (priceCache.value && Date.now() - priceCache.at < PRICE_CACHE_TTL_MS) return priceCache.value;

    const stripe = getStripe();
    if (!stripe) return {};

    const wanted = [
        ['pro', 'monthly', config.stripePriceProMonthly],
        ['pro', 'yearly', config.stripePriceProYearly],
        ['enterprise', 'monthly', config.stripePriceEnterpriseMonthly],
        ['enterprise', 'yearly', config.stripePriceEnterpriseYearly],
    ].filter(([, , id]) => !!id);

    const settled = await Promise.allSettled(
        wanted.map(([, , id]) => stripe.prices.retrieve(id)),
    );

    const prices = {};
    settled.forEach((outcome, i) => {
        const [tier, period] = wanted[i];
        // A price we cannot read is omitted, never guessed. The client keeps
        // its own default for that slot rather than advertising a number the
        // checkout would not honour.
        if (outcome.status !== 'fulfilled') {
            logger.warn({ tier, period }, 'Stripe price could not be resolved for /billing/config');
            return;
        }
        const price = outcome.value;
        if (!Number.isFinite(price?.unit_amount)) return;
        prices[tier] ??= {};
        prices[tier][period] = {
            amount: price.unit_amount,
            currency: price.currency,
            interval: price.recurring?.interval ?? null,
        };
    });

    priceCache = { at: Date.now(), value: prices };
    return prices;
}

// Public capability probe — no auth so the (possibly logged-out) pricing page
// can feature-detect before rendering the yearly toggle, and read the prices it
// is about to advertise. Amounts and currency only: never a price ID, never a
// secret.
router.get('/config', async (req, res) => {
    let prices = {};
    try {
        prices = await resolvePrices();
    } catch (err) {
        // Never fail the pricing page over a price lookup — the booleans below
        // still drive the toggle, and the client falls back to its defaults.
        logger.warn({ err }, 'Failed to resolve Stripe prices for /billing/config');
    }
    res.json({
        stripeEnabled: isStripeEnabled(),
        yearlyBillingAvailable: isYearlyBillingAvailable(),
        prices,
    });
});

// Create checkout session
router.post('/checkout', requireAuth, requireStripe, async (req, res) => {
    try {
        const parsed = checkoutSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'That request was missing something the server needs.', code: 'VALIDATION_ERROR' });

        const { tier, billingPeriod } = parsed.data;
        const stripe = getStripe();
        const userId = req.session.userId;

        let sub = db.prepare(
            'SELECT stripe_customer_id, stripe_subscription_id, status FROM user_subscriptions WHERE user_id = ?'
        ).get(userId);

        // A second checkout for a user who already pays creates a SECOND
        // Stripe subscription, while the webhook's ON CONFLICT(user_id) upsert
        // overwrites stripe_subscription_id — orphaning the first one, which
        // keeps billing forever with nothing in our DB pointing at it. Plan
        // changes belong in the billing portal, which prorates properly.
        if (sub?.stripe_subscription_id && ACTIVE_SUB_STATUSES.has(sub.status)) {
            return res.status(409).json({
                error: 'subscription_exists',
                message: 'You already have an active subscription. Use the billing portal to change your plan.',
            });
        }

        if (sub?.stripe_subscription_id && HELD_SUB_STATUSES.has(sub.status)) {
            return res.status(409).json({
                error: 'subscription_on_hold',
                message: 'Your subscription is on hold after a refund or payment dispute, and is still open in Stripe. Contact support to restore it — starting a new one here would bill you twice.',
            });
        }

        let customerId = sub?.stripe_customer_id;

        if (!customerId) {
            const customer = await stripe.customers.create({
                metadata: { userId: String(userId) },
            });
            customerId = customer.id;
            db.prepare(
                `INSERT INTO user_subscriptions (user_id, tier, stripe_customer_id, status)
                 VALUES (?, 'free', ?, 'active')
                 ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id = ?`
            ).run(userId, customerId, customerId);
        }

        const priceId = resolvePriceId(tier, billingPeriod);
        if (!priceId) return res.status(400).json({ error: `Price not configured for ${tier} ${billingPeriod} plan` });

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${config.frontendUrl}/settings?billing=success`,
            cancel_url: `${config.frontendUrl}/pricing`,
            metadata: { userId: String(userId), tier, billingPeriod },
        });

        res.json({ url: session.url });
    } catch (err) {
        logger.error({ err }, 'Failed to create checkout session');
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

// Customer portal
router.post('/portal', requireAuth, requireStripe, async (req, res) => {
    try {
        const stripe = getStripe();
        const sub = db.prepare('SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = ?').get(req.session.userId);
        if (!sub?.stripe_customer_id) return res.status(400).json({ error: 'No billing account found' });

        const session = await stripe.billingPortal.sessions.create({
            customer: sub.stripe_customer_id,
            return_url: `${config.frontendUrl}/settings`,
        });

        res.json({ url: session.url });
    } catch (err) {
        logger.error({ err }, 'Failed to create portal session');
        res.status(500).json({ error: 'Failed to create portal session' });
    }
});

// Get subscription status
router.get('/subscription', requireAuth, (req, res) => {
    const sub = db.prepare(
        'SELECT tier, status, current_period_end, stripe_subscription_id FROM user_subscriptions WHERE user_id = ?'
    ).get(req.session.userId);

    res.json(sub || { tier: 'free', status: 'active', current_period_end: null });
});

export default router;
