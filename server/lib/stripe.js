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
