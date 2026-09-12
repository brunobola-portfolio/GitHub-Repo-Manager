/**
 * G4 — Startup secrets verification (SOC 2 CC6.1)
 *
 * Validates that security-critical environment variables are set and strong
 * before the server accepts any traffic.  Call verifySecretsAtStartup() from
 * server/index.js immediately after environment loading; if errors are
 * returned, abort with process.exit(1).
 *
 * No runtime dependencies beyond Node built-ins.
 *
 * Deliberately reads process.env directly rather than server/config.js: this
 * runs as an independent, redundant secrets audit (it returns descriptive
 * errors/warnings for the caller to log, distinct from config.js's
 * fail-fast process.exit on a malformed value) and its own test suite
 * (startup-secrets-check.test.js) exercises it by mutating process.env
 * per-case with no module reset. config.js still validates ALLOW_MOCK_AUTH
 * and DISABLE_HTTPS_ENFORCEMENT at boot (B-12); this file's checks are a
 * second, environment-aware pass (e.g. ALLOW_MOCK_AUTH is only an error in
 * production).
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
    // API_KEY_SECRET was missing from this list: index.js checks it is SET in
    // production but nothing checked what it was set TO, so the template's
    // own placeholder passed. It hashes every API key; a guessable value
    // means forgeable keys.
    const required = ['SESSION_SECRET', 'WEBHOOK_SECRET', 'CREDENTIAL_ENCRYPTION_KEY', 'API_KEY_SECRET'];

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

        // A public, multi-tenant instance carries obligations a private one does
        // not, and every one of them is invisible until it costs money or hands
        // someone a tier they did not buy. DEPLOYMENT_MODE is the switch, so
        // this is the right place to check what only matters once strangers can
        // sign up. A self-host box is deliberately untouched by all of it.
        if ((process.env.DEPLOYMENT_MODE || 'self-host') === 'saas') {
            if (process.env.ALLOW_CONSOLE_EMAIL === 'true') {
                errors.push(
                    'ALLOW_CONSOLE_EMAIL=true is for single-user installs, and this is ' +
                    'DEPLOYMENT_MODE=saas: licence keys and retention warnings would be ' +
                    'written to the log instead of delivered — to customers who paid. ' +
                    'Configure EMAIL_PROVIDER=resend + RESEND_API_KEY and remove it.'
                );
            }
            // The per-user AI quotas are COUNTS, not money: N throwaway accounts
            // cost N x quota against the operator's own provider key, and the
            // spend cap ships at 0 (disabled). Without either a cap or
            // BYOK-only there is no ceiling and no kill switch short of pulling
            // the key.
            const serverAiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY
                || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
            const byokOnly = process.env.AI_REQUIRE_USER_CONFIG === 'true';
            const capped = Number(process.env.AI_SPEND_CAP_CENTS_FREE) > 0;
            if (serverAiKey && !byokOnly && !capped) {
                errors.push(
                    'A server-wide AI key is set on a saas deployment with neither ' +
                    'AI_REQUIRE_USER_CONFIG=true nor AI_SPEND_CAP_CENTS_FREE — every free ' +
                    'signup would spend the operator\'s provider budget with no ceiling. ' +
                    'Set one of the two.'
                );
            }
            if (process.env.GRM_DISABLE_WEB_SETUP !== 'true') {
                warnings.push(
                    'GRM_DISABLE_WEB_SETUP is not true on a saas deployment — the in-app ' +
                    'OAuth setup wizard exists for a self-hoster\'s first run and has ' +
                    'nothing to do on an instance that is already configured.'
                );
            }
            if (process.env.LICENSE_KEY) {
                warnings.push(
                    'LICENSE_KEY is set on a saas deployment, where an instance licence ' +
                    'grants nothing — Stripe is the only source of a paid tier. It is ' +
                    'probably a leftover from a self-host trial; remove it so nobody ' +
                    'debugs a tier against a key that does nothing.'
                );
            }
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

    // The template's own placeholders ("change-me-to-a-random-32-plus-byte-
    // string", "CHANGE_THIS_SECRET") are 41 characters long, so they passed
    // the length check above and only produced the warning below. A copied
    // .env.example therefore booted in production with a secret that is in
    // the public repository. In production that is an error; the broader
    // keyword check stays a warning, because "test" or "secret" can occur in
    // a genuinely random base64 string.
    const PLACEHOLDER = /change[-_ ]?(me|this)/i;
    for (const key of required) {
        const v = process.env[key] ?? '';
        if (v && PLACEHOLDER.test(v)) {
            (nodeEnv === 'production' ? errors : warnings).push(
                `${key} is the template placeholder — generate a real value (npm run gen:secrets)`
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
