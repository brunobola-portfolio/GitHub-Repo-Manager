import { getStripe, isStripeEnabled } from '../lib/stripe.js';
import { config } from '../config.js';
import db from '../db.js';
import logger from '../lib/logger.js';

const VALID_TIERS = new Set(['free', 'pro', 'enterprise']);

export async function stripeWebhookHandler(req, res) {
    if (!isStripeEnabled() || !config.stripeWebhookSecret) {
        return res.status(503).json({ error: 'Stripe webhooks not configured' });
    }

    const stripe = getStripe();
    const sig = req.headers['stripe-signature'];

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
    } catch (err) {
        logger.error({ err }, 'Stripe webhook signature verification failed');
        return res.status(400).json({ error: 'Invalid signature' });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const userId = parseInt(session.metadata?.userId);
                const rawTier = session.metadata?.tier || 'pro';
                const tier = VALID_TIERS.has(rawTier) ? rawTier : 'pro';
                if (userId) {
                    db.prepare(`
                        INSERT INTO user_subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, status)
                        VALUES (?, ?, ?, ?, 'active')
                        ON CONFLICT(user_id) DO UPDATE SET
                            tier = ?, stripe_customer_id = ?, stripe_subscription_id = ?, status = 'active', updated_at = datetime('now')
                    `).run(userId, tier, session.customer, session.subscription, tier, session.customer, session.subscription);
                }
                break;
            }

            case 'customer.subscription.updated': {
                const sub = event.data.object;
                const rawSubTier = sub.metadata?.tier || (sub.items?.data?.[0]?.price?.metadata?.tier) || 'pro';
                const tier = VALID_TIERS.has(rawSubTier) ? rawSubTier : 'pro';
                db.prepare(`
                    UPDATE user_subscriptions SET
                        tier = ?, status = ?, current_period_start = ?, current_period_end = ?, updated_at = datetime('now')
                    WHERE stripe_subscription_id = ?
                `).run(tier, sub.status, new Date(sub.current_period_start * 1000).toISOString(), new Date(sub.current_period_end * 1000).toISOString(), sub.id);
                break;
            }

            case 'customer.subscription.deleted': {
                const sub = event.data.object;
                db.prepare(`
                    UPDATE user_subscriptions SET tier = 'free', status = 'cancelled', updated_at = datetime('now')
                    WHERE stripe_subscription_id = ?
                `).run(sub.id);
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                if (invoice.subscription) {
                    db.prepare(`
                        UPDATE user_subscriptions SET status = 'past_due', updated_at = datetime('now')
                        WHERE stripe_subscription_id = ?
                    `).run(invoice.subscription);
                }
                break;
            }

            case 'invoice.paid': {
                const invoice = event.data.object;
                if (invoice.subscription) {
                    db.prepare(`
                        UPDATE user_subscriptions SET status = 'active', updated_at = datetime('now')
                        WHERE stripe_subscription_id = ?
                    `).run(invoice.subscription);
                }
                break;
            }
        }

        res.json({ received: true });
    } catch (err) {
        logger.error({ err, eventType: event.type }, 'Stripe webhook processing error');
        res.status(500).json({ error: 'Webhook processing failed' });
    }
}
