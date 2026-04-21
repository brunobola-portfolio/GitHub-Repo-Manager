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
    // CREDENTIAL_ENCRYPTION_KEY joins the required list (S1 — P0 security):
    // without a dedicated key, a leaked .env or session-store dump would also
    // expose every user BYOK credential and Azure PAT.
    const required = ['SESSION_SECRET', 'WEBHOOK_SECRET', 'CREDENTIAL_ENCRYPTION_KEY'];

    if (nodeEnv === 'production') {
        for (const key of required) {
            const v = process.env[key];
            if (!v) {
                errors.push(`${key} must be set in production`);
            } else if (v.length < 32) {
                errors.push(`${key} is shorter than 32 bytes (got ${v.length})`);
            }
        }

        // License signing key — required when Stripe billing is enabled.
        // Without it, paid customers receive no license key after checkout.
        if (process.env.STRIPE_SECRET_KEY && !process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM) {
            errors.push(
                'LICENSE_SIGNING_PRIVATE_KEY_PEM must be set when STRIPE_SECRET_KEY is present ' +
                '(required for license key issuance after checkout)'
            );
        }

        // Stripe webhook signature verification key — required when Stripe is
        // enabled. Without it, webhook signatures cannot be verified and a
        // forged payload could grant an attacker a paid tier.
        if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
            errors.push(
                'STRIPE_WEBHOOK_SECRET must be set when STRIPE_SECRET_KEY is present ' +
                '(required to verify Stripe webhook signatures — without it, forged ' +
                'webhooks could grant paid tiers)'
            );
        }

        // EMAIL_PROVIDER=console silently succeeds (logs, never sends). In
        // production that means license-key emails and data-retention warnings
        // are dropped on the floor. Default of 'console' is development-only.
        const emailProvider = process.env.EMAIL_PROVIDER;
        if (!emailProvider || emailProvider === 'console') {
            errors.push(
                'EMAIL_PROVIDER must be set to a real delivery driver in production ' +
                "(got '" + (emailProvider || '<unset>') + "'). Set EMAIL_PROVIDER=resend " +
                'and configure RESEND_API_KEY + EMAIL_FROM, otherwise license keys and ' +
                'retention warnings will never be delivered.'
            );
        } else if (emailProvider === 'resend' && !process.env.RESEND_API_KEY) {
            errors.push(
                'RESEND_API_KEY must be set when EMAIL_PROVIDER=resend'
            );
        }

        // Warn if HTTPS enforcement has been intentionally disabled.
        if (process.env.DISABLE_HTTPS_ENFORCEMENT === 'true') {
            warnings.push(
                'HTTPS enforcement is disabled via DISABLE_HTTPS_ENFORCEMENT=true ' +
                '— NOT recommended for production'
            );
        }

        // Non-HTTPS FRONTEND_URL will break CORS + cookies + HSTS in any real
        // browser; warn rather than abort so operators with a reverse proxy in
        // front of us can still override explicitly.
        const feUrl = process.env.FRONTEND_URL;
        if (feUrl && !/^https:\/\//.test(feUrl) && !/localhost|127\.0\.0\.1/.test(feUrl)) {
            warnings.push(
                `FRONTEND_URL=${feUrl} is not HTTPS — browsers will reject cookies with ` +
                'Secure flag and HSTS will fail. Serve over HTTPS or proxy through one.'
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
