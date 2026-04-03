import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getStripe, isStripeEnabled } from '../lib/stripe.js';
import { config } from '../config.js';
import { z } from 'zod';

const router = Router();

const checkoutSchema = z.object({
    tier: z.enum(['pro', 'enterprise']),
});

function requireStripe(req, res, next) {
    if (!isStripeEnabled()) {
        return res.status(503).json({ error: 'Billing is not configured' });
    }
    next();
}

// Create checkout session
router.post('/checkout', requireAuth, requireStripe, async (req, res) => {
    try {
        const parsed = checkoutSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

        const { tier } = parsed.data;
        const stripe = getStripe();
        const userId = req.session.userId;

        // Get or create Stripe customer
        let sub = db.prepare('SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = ?').get(userId);
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

        const priceId = tier === 'pro' ? config.stripePriceProMonthly : config.stripePriceEnterpriseMonthly;
        if (!priceId) return res.status(400).json({ error: `Price not configured for ${tier} tier` });

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${config.frontendUrl}/settings?billing=success`,
            cancel_url: `${config.frontendUrl}/pricing`,
            metadata: { userId: String(userId), tier },
        });

        res.json({ url: session.url });
    } catch (err) {
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
