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
        //
        // ALLOW_CONSOLE_EMAIL=true is an explicit, documented, single-purpose
        // opt-out for single-user/local installs (e.g. the Windows package)
        // where email delivery is meaningless — there is no one else to email,
        // and license-key/retention notices just log. It downgrades ONLY this
        // check to a warning; every other production guard still hard-aborts.
        const emailProvider = process.env.EMAIL_PROVIDER;
        const allowConsoleEmail = process.env.ALLOW_CONSOLE_EMAIL === 'true';
        if (!emailProvider || emailProvider === 'console') {
            const message =
                'EMAIL_PROVIDER must be set to a real delivery driver in production ' +
                "(got '" + (emailProvider || '<unset>') + "'). Set EMAIL_PROVIDER=resend " +
                'and configure RESEND_API_KEY + EMAIL_FROM, otherwise license keys and ' +
                'retention warnings will never be delivered.';
            if (allowConsoleEmail) {
                warnings.push(
                    message + ' Downgraded to a warning because ALLOW_CONSOLE_EMAIL=true ' +
                    '— only set that for single-user/local installs where email delivery ' +
                    'is not needed.'
                );
            } else {
                errors.push(message);
            }
        } else if (emailProvider === 'resend' && !process.env.RESEND_API_KEY) {
            errors.push(
                'RESEND_API_KEY must be set when EMAIL_PROVIDER=resend'
            );
        }

        // Mock-auth escape hatch must never be reachable in production.
        // server/routes/auth.js mounts POST /api/auth/mock whenever
        // ALLOW_MOCK_AUTH==='true' regardless of NODE_ENV, minting a fully
        // authenticated session (user 999999) with no credentials. A single
        // stray env var on an internet-exposed instance is therefore an
        // unauthenticated login bypass — hard-fail boot so it can't happen
        // silently.
        if (process.env.ALLOW_MOCK_AUTH === 'true') {
            errors.push(
                'ALLOW_MOCK_AUTH=true enables the unauthenticated mock-login endpoint ' +
                '(POST /api/auth/mock) in production — anyone could mint a session ' +
                'without credentials. Unset ALLOW_MOCK_AUTH; it is only for local development.'
            );
        }

        // VITE_MOCK_MODE=true makes the server seed demo users/repos into the
        // database at boot (index.js seedMockData). Harmless in dev, but a
        // copied-over dev .env would pollute a production DB with fake data.
        // Warn rather than abort so an operator who genuinely wants a seeded
        // demo instance can proceed explicitly.
        if (process.env.VITE_MOCK_MODE === 'true') {
            warnings.push(
                'VITE_MOCK_MODE=true seeds demo users/repos into the database at startup ' +
                '— not recommended in production. Set VITE_MOCK_MODE=false unless this is a demo instance.'
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
