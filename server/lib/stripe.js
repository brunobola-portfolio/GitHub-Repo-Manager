import Stripe from 'stripe';
import { config } from '../config.js';
import logger from './logger.js';

let stripe = null;

export function getStripe() {
    if (!stripe && config.stripeSecretKey) {
        try {
            stripe = new Stripe(config.stripeSecretKey, {
                apiVersion: '2024-12-18.acacia',
            });
        } catch (err) {
            logger.warn({ err }, 'Failed to initialize Stripe client');
        }
    }
    if (!stripe && config.stripeSecretKey) {
        logger.warn('getStripe() returned null but STRIPE_SECRET_KEY is configured');
    }
    return stripe;
}

/**
 * Billing is enabled only when BOTH halves of the Stripe pair are present.
 *
 * The secret key alone is enough to open a checkout and charge a card, but
 * without the webhook signing secret every event Stripe sends back is refused
 * (stripe-webhooks.js answers 503), so no licence is issued and no e-mail is
 * sent: the customer pays and receives nothing. In production the boot audit
 * already refuses to start in that state (startup-secrets-check.js), which is
 * why this never reached the live instance — but a self-hosted or staging
 * instance running outside production had no such guard, and this module
 * disagreed with the shell, which has always required both before advertising
 * a priced plan (index.js). One predicate, one answer: a half-configured
 * install advertises Free and answers 503 on checkout, which is the truth.
 */
export function isStripeEnabled() {
    return !!config.stripeSecretKey && !!config.stripeWebhookSecret;
}
