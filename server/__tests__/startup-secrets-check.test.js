// @vitest-environment node
/**
 * G4 — Startup secrets verification tests
 *
 * Tests:
 *  1. Production + missing SESSION_SECRET → error.
 *  2. Production + short SESSION_SECRET → error.
 *  3. Production + weak keyword ('password') → warning.
 *  4. Development with missing secret → no error, no warning for absence.
 *  5. Development with weak keyword → warning.
 *  6. Production + all strong secrets → no errors.
 *  7. Missing WEBHOOK_SECRET in production → error.
 *  8. DISABLE_HTTPS_ENFORCEMENT=true in production → warning.
 *  9. Missing CREDENTIAL_ENCRYPTION_KEY in production → error (S1).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { verifySecretsAtStartup } from '../lib/startup-secrets-check.js';

const STRONG = 'a'.repeat(40); // 40-char random-like string, no weak words

// Snapshot and restore process.env around each test.
let envSnapshot;

const TRACKED_KEYS = [
    'SESSION_SECRET', 'WEBHOOK_SECRET', 'CREDENTIAL_ENCRYPTION_KEY',
    'DISABLE_HTTPS_ENFORCEMENT', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'LICENSE_SIGNING_PRIVATE_KEY_PEM', 'EMAIL_PROVIDER', 'RESEND_API_KEY',
    'FRONTEND_URL', 'ALLOW_MOCK_AUTH', 'VITE_MOCK_MODE',
];

beforeEach(() => {
    envSnapshot = { ...process.env };
    for (const k of TRACKED_KEYS) delete process.env[k];
    // Production-good defaults for email + URL so tests that only exercise a
    // different axis don't trip the new email / HTTPS guards. Tests that want
    // to assert those guards explicitly unset these.
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.FRONTEND_URL = 'https://example.com';
});

afterEach(() => {
    for (const k of TRACKED_KEYS) {
        if (envSnapshot[k] !== undefined) {
            process.env[k] = envSnapshot[k];
        } else {
            delete process.env[k];
        }
    }
});

describe('G4 — verifySecretsAtStartup', () => {
    // -----------------------------------------------------------------------
    // Production — required key checks
    // -----------------------------------------------------------------------

    it('production + missing SESSION_SECRET → error', () => {
        process.env.WEBHOOK_SECRET = STRONG;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('SESSION_SECRET') && e.includes('must be set'))).toBe(true);
    });

    it('production + missing WEBHOOK_SECRET → error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('WEBHOOK_SECRET') && e.includes('must be set'))).toBe(true);
    });

    it('production + short SESSION_SECRET (< 32 bytes) → error', () => {
        process.env.SESSION_SECRET = 'short';
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('SESSION_SECRET') && e.includes('shorter than 32'))).toBe(true);
    });

    it('production + short WEBHOOK_SECRET (< 32 bytes) → error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = 'tiny';
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('WEBHOOK_SECRET') && e.includes('shorter than 32'))).toBe(true);
    });

    // S1 — CREDENTIAL_ENCRYPTION_KEY is now a first-class required secret in prod.
    it('production + missing CREDENTIAL_ENCRYPTION_KEY → error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('CREDENTIAL_ENCRYPTION_KEY') && e.includes('must be set'))).toBe(true);
    });

    it('production + short CREDENTIAL_ENCRYPTION_KEY (< 32 bytes) → error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = 'tooshort';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('CREDENTIAL_ENCRYPTION_KEY') && e.includes('shorter than 32'))).toBe(true);
    });

    it('development + missing CREDENTIAL_ENCRYPTION_KEY → no error (fallback to SESSION_SECRET allowed)', () => {
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'development' });
        expect(errors.some(e => e.includes('CREDENTIAL_ENCRYPTION_KEY'))).toBe(false);
    });

    it('production + all strong secrets → no errors', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // Weak keyword detection (any environment)
    // -----------------------------------------------------------------------

    it('production + SESSION_SECRET containing "password" → warning', () => {
        process.env.SESSION_SECRET = 'my_long_password_key_that_is_definitely_over_32_chars';
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        const { warnings } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(warnings.some(w => w.includes('SESSION_SECRET') && w.includes('weak default'))).toBe(true);
    });

    it('production + WEBHOOK_SECRET containing "secret" → warning', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = 'webhook_secret_value_that_is_at_least_32_chars_long!';
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        const { warnings } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(warnings.some(w => w.includes('WEBHOOK_SECRET') && w.includes('weak default'))).toBe(true);
    });

    it('development + SESSION_SECRET containing "test" → warning (no error)', () => {
        process.env.SESSION_SECRET = 'test_session_secret_that_is_long_enough_to_be_over_32';
        const { errors, warnings } = verifySecretsAtStartup({ nodeEnv: 'development' });
        expect(errors).toHaveLength(0);
        expect(warnings.some(w => w.includes('SESSION_SECRET'))).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Development — absence is NOT an error
    // -----------------------------------------------------------------------

    it('development + missing SESSION_SECRET → no error', () => {
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'development' });
        expect(errors).toHaveLength(0);
    });

    it('development + missing WEBHOOK_SECRET → no error', () => {
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'development' });
        expect(errors).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // HTTPS enforcement warning
    // -----------------------------------------------------------------------

    it('production + DISABLE_HTTPS_ENFORCEMENT=true → warning', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.DISABLE_HTTPS_ENFORCEMENT = 'true';
        const { warnings } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(warnings.some(w => w.includes('HTTPS enforcement is disabled'))).toBe(true);
    });

    it('production + DISABLE_HTTPS_ENFORCEMENT=false → no HTTPS warning', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.DISABLE_HTTPS_ENFORCEMENT = 'false';
        const { warnings } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(warnings.some(w => w.includes('HTTPS enforcement is disabled'))).toBe(false);
    });

    // -----------------------------------------------------------------------
    // C3 — LICENSE_SIGNING_PRIVATE_KEY_PEM conditional check
    // -----------------------------------------------------------------------

    it('production + STRIPE_SECRET_KEY set + missing LICENSE_SIGNING_PRIVATE_KEY_PEM → error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.STRIPE_SECRET_KEY = 'sk_live_xxxxxxxxxxxxxxxxxxxxx';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('LICENSE_SIGNING_PRIVATE_KEY_PEM'))).toBe(true);
    });

    it('production + STRIPE_SECRET_KEY set + LICENSE_SIGNING_PRIVATE_KEY_PEM set → no error for license key', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.STRIPE_SECRET_KEY = 'sk_live_xxxxxxxxxxxxxxxxxxxxx';
        process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\nMCowBQYDK2VwAyEA...\n-----END PRIVATE KEY-----';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('LICENSE_SIGNING_PRIVATE_KEY_PEM'))).toBe(false);
    });

    it('production + no STRIPE_SECRET_KEY + no LICENSE_SIGNING_PRIVATE_KEY_PEM → no error (billing not enabled)', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('LICENSE_SIGNING_PRIVATE_KEY_PEM'))).toBe(false);
    });

    // -----------------------------------------------------------------------
    // STRIPE_WEBHOOK_SECRET conditional check
    // -----------------------------------------------------------------------

    it('production + STRIPE_SECRET_KEY set + missing STRIPE_WEBHOOK_SECRET → error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.STRIPE_SECRET_KEY = 'sk_live_test';
        process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\n...';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('STRIPE_WEBHOOK_SECRET'))).toBe(true);
    });

    it('production + Stripe fully configured → no Stripe-related errors', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.STRIPE_SECRET_KEY = 'sk_live_test';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
        process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\n...';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('STRIPE_WEBHOOK_SECRET'))).toBe(false);
        expect(errors.some(e => e.includes('LICENSE_SIGNING_PRIVATE_KEY_PEM'))).toBe(false);
    });

    // -----------------------------------------------------------------------
    // EMAIL_PROVIDER check — must be a real driver in production
    // -----------------------------------------------------------------------

    it('production + EMAIL_PROVIDER=console → error (silent no-op)', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.EMAIL_PROVIDER = 'console';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('EMAIL_PROVIDER'))).toBe(true);
    });

    it('production + EMAIL_PROVIDER unset → error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        delete process.env.EMAIL_PROVIDER;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('EMAIL_PROVIDER'))).toBe(true);
    });

    it('production + EMAIL_PROVIDER=resend + missing RESEND_API_KEY → error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.EMAIL_PROVIDER = 'resend';
        delete process.env.RESEND_API_KEY;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('RESEND_API_KEY'))).toBe(true);
    });

    it('development + EMAIL_PROVIDER=console → no error', () => {
        process.env.EMAIL_PROVIDER = 'console';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'development' });
        expect(errors).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // FRONTEND_URL HTTPS warning
    // -----------------------------------------------------------------------

    it('production + FRONTEND_URL with http:// → warning', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.FRONTEND_URL = 'http://app.example.com';
        const { warnings } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(warnings.some(w => w.includes('FRONTEND_URL') && w.includes('HTTPS'))).toBe(true);
    });

    it('production + FRONTEND_URL with https:// → no HTTPS warning', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.FRONTEND_URL = 'https://app.example.com';
        const { warnings } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(warnings.some(w => w.includes('FRONTEND_URL') && w.includes('HTTPS'))).toBe(false);
    });

    it('production + FRONTEND_URL points at localhost → no HTTPS warning (reverse-proxy escape hatch)', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.FRONTEND_URL = 'http://localhost:5173';
        const { warnings } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(warnings.some(w => w.includes('FRONTEND_URL') && w.includes('HTTPS'))).toBe(false);
    });

    // -----------------------------------------------------------------------
    // ALLOW_MOCK_AUTH — must hard-fail production boot (unauthenticated login)
    // -----------------------------------------------------------------------

    it('production + ALLOW_MOCK_AUTH=true → error (unauthenticated mock login reachable)', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.ALLOW_MOCK_AUTH = 'true';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('ALLOW_MOCK_AUTH') && e.includes('mock-login'))).toBe(true);
    });

    it('production + ALLOW_MOCK_AUTH unset → no ALLOW_MOCK_AUTH error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('ALLOW_MOCK_AUTH'))).toBe(false);
    });

    it('production + ALLOW_MOCK_AUTH=false → no ALLOW_MOCK_AUTH error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.ALLOW_MOCK_AUTH = 'false';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('ALLOW_MOCK_AUTH'))).toBe(false);
    });

    it('development + ALLOW_MOCK_AUTH=true → no error (dev tooling relies on it)', () => {
        process.env.ALLOW_MOCK_AUTH = 'true';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'development' });
        expect(errors.some(e => e.includes('ALLOW_MOCK_AUTH'))).toBe(false);
    });

    // -----------------------------------------------------------------------
    // VITE_MOCK_MODE — warn in production (seeds demo data)
    // -----------------------------------------------------------------------

    it('production + VITE_MOCK_MODE=true → warning (seeds demo data)', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.VITE_MOCK_MODE = 'true';
        const { warnings } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(warnings.some(w => w.includes('VITE_MOCK_MODE') && w.includes('demo'))).toBe(true);
    });

    it('production + VITE_MOCK_MODE=true → warning only, not an error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.CREDENTIAL_ENCRYPTION_KEY = STRONG;
        process.env.VITE_MOCK_MODE = 'true';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('VITE_MOCK_MODE'))).toBe(false);
    });
});
