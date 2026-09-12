// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
 * The real predicate, not a double. Every other Stripe test mocks
 * `isStripeEnabled` wholesale (billing-checkout.test.js, stripe-webhooks.test.js),
 * which is right for those — they exercise the routes — but it left the
 * predicate itself with no coverage at all. That is how it came to disagree
 * with the shell in server/index.js, which requires both halves of the pair
 * before it will advertise a priced plan.
 */
const mockConfig = { stripeSecretKey: undefined, stripeWebhookSecret: undefined };
vi.mock('../config.js', () => ({ config: mockConfig }));
vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { isStripeEnabled } = await import('../lib/stripe.js');

beforeEach(() => {
    mockConfig.stripeSecretKey = undefined;
    mockConfig.stripeWebhookSecret = undefined;
});

describe('isStripeEnabled', () => {
    it('is off when nothing is configured', () => {
        expect(isStripeEnabled()).toBe(false);
    });

    it('is OFF with only the secret key, because that charges cards it cannot fulfil', () => {
        // A checkout opens and Stripe takes the money, but every webhook it
        // sends back is refused for want of a signing secret, so no licence is
        // ever issued. Advertising Pro in that state is the defect.
        mockConfig.stripeSecretKey = 'sk_live_whatever';
        expect(isStripeEnabled()).toBe(false);
    });

    it('is off with only the webhook secret', () => {
        mockConfig.stripeWebhookSecret = 'whsec_whatever';
        expect(isStripeEnabled()).toBe(false);
    });

    it('is on only once both halves are present', () => {
        mockConfig.stripeSecretKey = 'sk_live_whatever';
        mockConfig.stripeWebhookSecret = 'whsec_whatever';
        expect(isStripeEnabled()).toBe(true);
    });

    it('treats an empty string as unset, so a blank .env line does not enable billing', () => {
        mockConfig.stripeSecretKey = '';
        mockConfig.stripeWebhookSecret = '';
        expect(isStripeEnabled()).toBe(false);
        mockConfig.stripeSecretKey = 'sk_live_whatever';
        expect(isStripeEnabled()).toBe(false);
    });

    it('agrees with the rule the shell applies before advertising a priced offer', () => {
        // server/index.js: stripeEnabled: Boolean(config.stripeSecretKey && config.stripeWebhookSecret).
        // These two must never disagree — one says what the crawler is told,
        // the other what the checkout route allows.
        const shellRule = (c) => Boolean(c.stripeSecretKey && c.stripeWebhookSecret);
        for (const pair of [
            { stripeSecretKey: undefined, stripeWebhookSecret: undefined },
            { stripeSecretKey: 'sk', stripeWebhookSecret: undefined },
            { stripeSecretKey: undefined, stripeWebhookSecret: 'whsec' },
            { stripeSecretKey: 'sk', stripeWebhookSecret: 'whsec' },
        ]) {
            Object.assign(mockConfig, pair);
            expect(isStripeEnabled(), JSON.stringify(pair)).toBe(shellRule(pair));
        }
    });
});
