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
    //
    // Important: we wrap the idempotency insert + synchronous DB mutations
    // for this event in a single better-sqlite3 transaction. If any of those
    // synchronous writes throws, SQLite rolls back the idempotency row so a
    // Stripe retry will reprocess the event fresh rather than see it as
    // already-handled. Async side effects (Stripe API calls, license
    // issuance + email) are performed OUTSIDE the transaction — their order
    // is: idempotency INSERT + DB writes (inside txn) → email (after commit).
    // If the async license issuance throws, we remove the idempotency row
    // explicitly so the next retry can proceed.
    let deduped = false;
    const runIdempotentDbWork = db.transaction(() => {
        const result = db.prepare(
            'INSERT OR IGNORE INTO webhook_events (id, source, type, processed_at) VALUES (?, ?, ?, ?)'
        ).run(event.id, 'stripe', event.type, Date.now());
        if (result.changes === 0) {
            deduped = true;
            return null;
        }
        // Only the sync DB writes that depend on the event body run here. The
        // per-event-type async handling (Stripe API calls, license emission)
        // runs outside, after commit. We return a structured "pending" record
        // the caller uses to drive the async phase.
        return { kind: 'committed' };
    });

    let ledgerResult;
    try {
        ledgerResult = runIdempotentDbWork();
    } catch (err) {
        logger.error({ err, eventId: event.id }, 'Stripe webhook: idempotency ledger transaction failed');
        return res.status(500).json({ error: 'Webhook ledger failure' });
    }

    if (deduped || ledgerResult === null) {
        return res.json({ received: true, deduped: true });
    }

    // Helper: remove the idempotency row when async processing fails, so the
    // next Stripe retry reprocesses the event rather than being deduped.
    const forgetIdempotency = () => {
        try {
            db.prepare('DELETE FROM webhook_events WHERE id = ? AND source = ?').run(event.id, 'stripe');
        } catch (cleanupErr) {
            logger.error({ err: cleanupErr, eventId: event.id }, 'Stripe webhook: failed to roll back idempotency row after async failure');
        }
    };

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const userId = parseInt(session.metadata?.userId);
                const rawTier = session.metadata?.tier || 'pro';
                const tier = await reconcileTierFromPrice(stripe, session, rawTier, session.id);
                // billingPeriod comes from the checkout session metadata
                // (routes/billing.js ~line 89); default 'monthly' covers older
                // clients/webhooks that predate the yearly toggle. The emailed
                // license's validity must match what was actually paid for — a
                // monthly $19 sub must not carry a 12-month irrevocable key.
                const billingPeriod = session.metadata?.billingPeriod === 'yearly' ? 'yearly' : 'monthly';
                const licenseMonths = billingPeriod === 'yearly' ? 12 : 1;

                if (userId) {
                    // Synchronous subscription write wrapped in a transaction so
                    // a failure here rolls back cleanly before we attempt license
                    // issuance. We run it via db.transaction purely for atomicity
                    // of the upsert itself — the parent idempotency insert is
                    // already committed at this point because better-sqlite3
                    // cannot span async boundaries within a single transaction.
                    try {
                        db.transaction(() => {
                            db.prepare(`
                                INSERT INTO user_subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, status, billing_period)
                                VALUES (?, ?, ?, ?, 'active', ?)
                                ON CONFLICT(user_id) DO UPDATE SET
                                    tier = ?, stripe_customer_id = ?, stripe_subscription_id = ?, status = 'active', billing_period = ?, updated_at = datetime('now')
                            `).run(userId, tier, session.customer, session.subscription, billingPeriod, tier, session.customer, session.subscription, billingPeriod);
                        })();
                    } catch (err) {
                        logger.error({ err, sessionId: session.id }, 'stripe-webhook: subscription upsert failed — rolling back idempotency');
                        forgetIdempotency();
                        return res.status(500).json({ error: 'Subscription write failed' });
                    }

                    // Issue + email license AFTER DB commit. If license issuance
                    // throws, roll back the idempotency row so Stripe's retry
                    // can reprocess this event fresh and we get another shot at
                    // emitting the license. The subscription upsert above is
                    // idempotent (ON CONFLICT DO UPDATE) so re-running it on
                    // retry is safe — we don't need to undo it.
                    //
                    // Note: issueLicenseForCheckout swallows its OWN errors
                    // (email failures, signing-key issues) and does not throw
                    // in those cases — so only an unexpected failure such as
                    // Stripe customer retrieval timing out will land here.
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
                                months: licenseMonths,
                                stripeSubscriptionId: session.subscription,
                                stripeSessionId: session.id,
                            });
                        } else {
                            logger.warn({ userId, sessionId: session.id }, 'stripe-webhook: no email for license delivery');
                        }
                    } catch (err) {
                        logger.error({ err, sessionId: session.id }, 'stripe-webhook: license issuance failed — rolling back idempotency so Stripe retry can reprocess');
                        forgetIdempotency();
                        return res.status(500).json({ error: 'License issuance failed' });
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

                    // Renewal license reissue: an emailed key's validity
                    // matches exactly what was paid for (1 month, or 12 for
                    // yearly — see checkout.session.completed above and
                    // license.js's calendar-month exp), so each paid renewal
                    // invoice needs its own fresh one. This applies to BOTH
                    // billing periods: a yearly customer's year-2 renewal is
                    // this exact event, and without a reissue here they'd pay
                    // and never receive a new key.
                    //
                    // billing_reason='subscription_cycle' is Stripe's marker
                    // for a recurring renewal invoice, as opposed to
                    // 'subscription_create' — which fires for that SAME
                    // subscription's very first invoice and would otherwise
                    // double-email a brand-new subscriber alongside the
                    // checkout.session.completed handler above.
                    if (invoice.billing_reason === 'subscription_cycle') {
                        const subRow = db.prepare(
                            'SELECT user_id, tier, billing_period FROM user_subscriptions WHERE stripe_subscription_id = ?'
                        ).get(invoice.subscription);

                        if (subRow?.user_id) {
                            const user = db.prepare('SELECT email FROM users WHERE id = ?').get(subRow.user_id);
                            const recipientEmail = invoice.customer_email || user?.email;
                            if (recipientEmail) {
                                await issueLicenseForCheckout({
                                    userId: subRow.user_id,
                                    email: recipientEmail,
                                    tier: subRow.tier,
                                    seats: 1,
                                    months: subRow.billing_period === 'yearly' ? 12 : 1,
                                    stripeSubscriptionId: invoice.subscription,
                                    // invoice.id is the natural idempotency key
                                    // for a renewal reissue — one license per
                                    // paid invoice, mirroring
                                    // issueLicenseForCheckout's per-checkout-
                                    // session idempotency for initial issuance.
                                    stripeSessionId: invoice.id,
                                });
                            } else {
                                logger.warn({ subscriptionId: invoice.subscription, invoiceId: invoice.id }, 'stripe-webhook: no email for renewal license delivery');
                            }
                        }
                    }
                }
                break;
            }
        }

        res.json({ received: true });
    } catch (err) {
        logger.error({ err, eventType: event.type }, 'Stripe webhook processing error');
        // Async failure on a non-checkout event path (e.g. failing UPDATE on a
        // subscription row). Remove the idempotency row so Stripe's retry can
        // reprocess the event fresh rather than being silently deduped.
        forgetIdempotency();
        res.status(500).json({ error: 'Webhook processing failed' });
    }
}
