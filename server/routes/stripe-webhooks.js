import { getStripe, isStripeEnabled } from '../lib/stripe.js';
import { config } from '../config.js';
import db from '../db.js';
import logger from '../lib/logger.js';
import { issueLicenseForCheckout } from '../lib/license-issuer.js';

const VALID_TIERS = new Set(['free', 'pro', 'enterprise']);

/**
 * Cross-check the tier from session/subscription metadata against the actual
 * price object's metadata. If they disagree, log a warning and prefer the
 * price's tier (it's the source of truth — session metadata can be stale or
 * tampered if the Stripe account is compromised). Falls back to the supplied
 * `metadataTier` if we can't fetch the price (e.g. line items missing).
 */
async function reconcileTierFromPrice(stripe, sessionOrSub, metadataTier, sessionId) {
    try {
        let priceTier = null;
        if (sessionId) {
            const items = await stripe.checkout.sessions.listLineItems(sessionId, { expand: ['data.price'], limit: 5 });
            priceTier = items.data?.[0]?.price?.metadata?.tier || null;
        } else if (sessionOrSub?.items?.data?.[0]?.price?.metadata?.tier) {
            priceTier = sessionOrSub.items.data[0].price.metadata.tier;
        }
        if (priceTier && VALID_TIERS.has(priceTier)) {
            if (metadataTier && metadataTier !== priceTier) {
                logger.warn({ priceTier, metadataTier }, 'Stripe webhook: tier mismatch between session metadata and price metadata; using price metadata');
            }
            return priceTier;
        }
    } catch (err) {
        logger.warn({ err }, 'Stripe webhook: failed to reconcile tier from price; using metadata fallback');
    }
    return VALID_TIERS.has(metadataTier) ? metadataTier : 'pro';
}

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

    // Idempotency: Stripe retries up to 5 times. Use INSERT OR IGNORE so the
    // check-then-insert is one atomic statement (no race window between two
    // concurrent retries). `changes` reports 0 when the event id was already
    // present, in which case we reply 200 and skip further processing.
    try {
        const result = db.prepare(
            'INSERT OR IGNORE INTO webhook_events (id, source, type, processed_at) VALUES (?, ?, ?, ?)'
        ).run(event.id, 'stripe', event.type, Date.now());
        if (result.changes === 0) {
            return res.json({ received: true, deduped: true });
        }
    } catch (err) {
        logger.error({ err, eventId: event.id }, 'Stripe webhook: idempotency check failed');
        return res.status(500).json({ error: 'Webhook ledger failure' });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const userId = parseInt(session.metadata?.userId);
                const rawTier = session.metadata?.tier || 'pro';
                const tier = await reconcileTierFromPrice(stripe, session, rawTier, session.id);

                if (userId) {
                    db.prepare(`
                        INSERT INTO user_subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, status)
                        VALUES (?, ?, ?, ?, 'active')
                        ON CONFLICT(user_id) DO UPDATE SET
                            tier = ?, stripe_customer_id = ?, stripe_subscription_id = ?, status = 'active', updated_at = datetime('now')
                    `).run(userId, tier, session.customer, session.subscription, tier, session.customer, session.subscription);

                    // Issue + email license (best-effort; webhook must still return 200)
                    try {
                        const stripeCustomer = await stripe.customers.retrieve(session.customer);
                        const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
                        const recipientEmail = stripeCustomer.email || user?.email;
                        if (recipientEmail) {
                            await issueLicenseForCheckout({
                                userId,
                                email: recipientEmail,
                                tier,
                                seats: parseInt(session.metadata?.seats) || 1,
                                months: 12,
                                stripeSubscriptionId: session.subscription,
                                stripeSessionId: session.id,
                            });
                        } else {
                            logger.warn({ userId, sessionId: session.id }, 'stripe-webhook: no email for license delivery');
                        }
                    } catch (err) {
                        logger.error({ err, sessionId: session.id }, 'stripe-webhook: license issuance failed');
                        // Do NOT rethrow — return 200 to Stripe regardless
                    }
                }
                break;
            }

            case 'customer.subscription.updated': {
                const sub = event.data.object;
                const rawSubTier = sub.metadata?.tier || (sub.items?.data?.[0]?.price?.metadata?.tier) || 'pro';
                const tier = await reconcileTierFromPrice(stripe, sub, rawSubTier, null);
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
