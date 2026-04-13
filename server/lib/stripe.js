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

export function isStripeEnabled() {
    return !!config.stripeSecretKey;
}
