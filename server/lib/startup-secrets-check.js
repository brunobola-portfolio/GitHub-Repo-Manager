/**
 * G4 — Startup secrets verification (SOC 2 CC6.1)
 *
 * Validates that security-critical environment variables are set and strong
 * before the server accepts any traffic.  Call verifySecretsAtStartup() from
 * server/index.js immediately after environment loading; if errors are
 * returned, abort with process.exit(1).
 *
 * No runtime dependencies beyond Node built-ins.
 */

/**
 * Verify that all security-critical secrets meet minimum strength requirements.
 *
 * @param {object} opts
 * @param {string} opts.nodeEnv - 'production' | 'development' | 'test'
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function verifySecretsAtStartup({ nodeEnv }) {
    const errors = [];
    const warnings = [];

    // In production every security-critical key must be present and strong.
    const required = ['SESSION_SECRET', 'WEBHOOK_SECRET'];

    if (nodeEnv === 'production') {
        for (const key of required) {
            const v = process.env[key];
            if (!v) {
                errors.push(`${key} must be set in production`);
            } else if (v.length < 32) {
                errors.push(`${key} is shorter than 32 bytes (got ${v.length})`);
            }
        }

        // Credential encryption relies on CREDENTIAL_ENCRYPTION_KEY with a
        // fallback to SESSION_SECRET (see server/lib/credential-encryption.js:11).
        if (!process.env.CREDENTIAL_ENCRYPTION_KEY && !process.env.SESSION_SECRET) {
            errors.push(
                'CREDENTIAL_ENCRYPTION_KEY or SESSION_SECRET must be set ' +
                '(used for user credential encryption)'
            );
        }

        // License signing key — required when Stripe billing is enabled.
        // Without it, paid customers receive no license key after checkout.
        if (process.env.STRIPE_SECRET_KEY && !process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM) {
            errors.push(
                'LICENSE_SIGNING_PRIVATE_KEY_PEM must be set when STRIPE_SECRET_KEY is present ' +
                '(required for license key issuance after checkout)'
            );
        }

        // Warn if HTTPS enforcement has been intentionally disabled.
        if (process.env.DISABLE_HTTPS_ENFORCEMENT === 'true') {
            warnings.push(
                'HTTPS enforcement is disabled via DISABLE_HTTPS_ENFORCEMENT=true ' +
                '— NOT recommended for production'
            );
        }
    }

    // Always warn when a key contains a weak default keyword — catches
    // copy-paste mistakes in any environment.
    const WEAK = ['change', 'secret', 'password', 'default', 'test'];
    for (const key of required) {
        const v = (process.env[key] ?? '').toLowerCase();
        if (v && WEAK.some(w => v.includes(w))) {
            warnings.push(
                `${key} contains weak default keyword — rotate with a strong random value`
            );
        }
    }

    return { errors, warnings };
}
