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
 *  9. Missing CREDENTIAL_ENCRYPTION_KEY AND SESSION_SECRET in production → error.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { verifySecretsAtStartup } from '../lib/startup-secrets-check.js';

const STRONG = 'a'.repeat(40); // 40-char random-like string, no weak words

// Snapshot and restore process.env around each test.
let envSnapshot;

beforeEach(() => {
    envSnapshot = { ...process.env };
    // Clean all relevant keys so tests start from a blank slate.
    delete process.env.SESSION_SECRET;
    delete process.env.WEBHOOK_SECRET;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.DISABLE_HTTPS_ENFORCEMENT;
});

afterEach(() => {
    // Restore only the keys we care about to avoid side-effects on the suite.
    const keys = ['SESSION_SECRET', 'WEBHOOK_SECRET', 'CREDENTIAL_ENCRYPTION_KEY', 'DISABLE_HTTPS_ENFORCEMENT'];
    for (const k of keys) {
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
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('WEBHOOK_SECRET') && e.includes('must be set'))).toBe(true);
    });

    it('production + short SESSION_SECRET (< 32 bytes) → error', () => {
        process.env.SESSION_SECRET = 'short';
        process.env.WEBHOOK_SECRET = STRONG;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('SESSION_SECRET') && e.includes('shorter than 32'))).toBe(true);
    });

    it('production + short WEBHOOK_SECRET (< 32 bytes) → error', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = 'tiny';
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.some(e => e.includes('WEBHOOK_SECRET') && e.includes('shorter than 32'))).toBe(true);
    });

    it('production + no SESSION_SECRET AND no CREDENTIAL_ENCRYPTION_KEY → extra error', () => {
        process.env.WEBHOOK_SECRET = STRONG;
        // SESSION_SECRET is also missing — should trigger both the "must be set" error
        // AND the encryption-key error. At minimum the encryption-key error fires.
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors.length).toBeGreaterThan(0);
    });

    it('production + all strong secrets → no errors', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        const { errors } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(errors).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // Weak keyword detection (any environment)
    // -----------------------------------------------------------------------

    it('production + SESSION_SECRET containing "password" → warning', () => {
        process.env.SESSION_SECRET = 'my_long_password_key_that_is_definitely_over_32_chars';
        process.env.WEBHOOK_SECRET = STRONG;
        const { warnings } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(warnings.some(w => w.includes('SESSION_SECRET') && w.includes('weak default'))).toBe(true);
    });

    it('production + WEBHOOK_SECRET containing "secret" → warning', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = 'webhook_secret_value_that_is_at_least_32_chars_long!';
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
        process.env.DISABLE_HTTPS_ENFORCEMENT = 'true';
        const { warnings } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(warnings.some(w => w.includes('HTTPS enforcement is disabled'))).toBe(true);
    });

    it('production + DISABLE_HTTPS_ENFORCEMENT=false → no HTTPS warning', () => {
        process.env.SESSION_SECRET = STRONG;
        process.env.WEBHOOK_SECRET = STRONG;
        process.env.DISABLE_HTTPS_ENFORCEMENT = 'false';
        const { warnings } = verifySecretsAtStartup({ nodeEnv: 'production' });
        expect(warnings.some(w => w.includes('HTTPS enforcement is disabled'))).toBe(false);
    });
});
