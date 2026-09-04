// Side-effect import: populates process.env from the .env file (honouring
// GRM_ENV_FILE). Kept in its own module so entry points can import it BEFORE
// anything that reads process.env at module-evaluation time — see the comment
// in lib/env/load-dotenv.js for the DATA_DIR bug that motivated the split.
import './lib/env/load-dotenv.js';
import { z } from 'zod';

// --- Operator boolean-toggle helper (B-12) ----------------------------------
// Case-sensitive 'true'/'false' only. Unset AND explicit-empty (`KEY=` in a
// .env file, which dotenv parses as '') both resolve to `def`; anything else
// (a typo like 'True', 'yes', '1') is passed through unchanged so the
// z.boolean() check that wraps this rejects it — a bad value fails config
// parsing at boot instead of silently taking the default or the opposite
// meaning. Mirrors the two toggles migrated ahead of this pass, below.
const boolFlag = (def) => z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return def;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v;
}, z.boolean());

const configSchema = z.object({
    // Server
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    port: z.coerce.number().default(3001),
    // Bind address passed to app.listen(port, host). Unset preserves the
    // historical behavior of binding all interfaces (Node's default when no
    // host is passed). The Windows package sets this to 127.0.0.1 so the
    // firewall prompt never appears and the server isn't LAN-exposed by default.
    host: z.string().optional(),

    // Session
    sessionSecret: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

    // GitHub OAuth (optional - app runs in mock mode without these)
    githubClientId: z.string().optional(),
    githubClientSecret: z.string().optional(),

    // Frontend
    frontendUrl: z.string().default('http://localhost:5173'),

    // Database (optional - defaults to SQLite)
    databaseUrl: z.string().optional(),

    // Redis (optional - enables distributed sessions & job queues)
    redisUrl: z.string().optional(),

    // AI (optional)
    geminiApiKey: z.string().optional(),
    geminiModel: z.string().default('gemini-2.5-flash'),
    geminiEmbeddingModel: z.string().default('gemini-embedding-001'),
    // Server-wide fallback provider (per-user BYOK overrides this). Validated
    // here so a typo fails fast at startup instead of at the first AI call.
    aiProvider: z.enum(['gemini', 'anthropic', 'openai', 'openrouter', 'local']).default('gemini'),

    // Monitoring (optional)
    sentryDsn: z.string().optional(),

    // Azure DevOps (optional)
    azurePat: z.string().optional(),

    // Webhooks (optional)
    webhookSecret: z.string().optional(),

    // License key (optional, for self-hosted Pro/Enterprise)
    licenseKey: z.string().optional(),

    // Stripe (optional, enables billing)
    stripeSecretKey: z.string().optional(),
    stripeWebhookSecret: z.string().optional(),
    stripePriceProMonthly: z.string().optional(),
    stripePriceProYearly: z.string().optional(),
    stripePriceEnterpriseMonthly: z.string().optional(),
    stripePriceEnterpriseYearly: z.string().optional(),

    // Credential vault — AES-256-GCM key for encrypting user BYOK keys and Azure PATs.
    // Falls back to SESSION_SECRET if unset.
    credentialEncryptionKey: z.string().optional(),

    // API key signing secret (grm_live_* keys)
    apiKeySecret: z.string().optional(),

    // Email delivery ('console' | 'resend')
    emailProvider: z.enum(['console', 'resend']).default('console'),
    resendApiKey: z.string().optional(),
    emailFrom: z.string().optional(),

    // License issuance — Ed25519 PEM key. Required in prod when Stripe is enabled.
    licenseSigningPrivateKeyPem: z.string().optional(),

    // Data retention (G2)
    dataRetentionDays: z.coerce.number().default(365),
    dataRetentionWarningLeadDays: z.coerce.number().default(30),

    // AI multi-tenant enforcement
    aiRequireUserConfig: z.string().optional(),
    disableAiReview: z.string().optional(),

    // Observability
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    // Mock mode
    mockMode: z.string().optional(),

    // --- B-12: operator-facing vars formerly read straight from process.env,
    // outside this schema's fail-fast validation. Each now parses (and boots
    // fail-fast on a typo'd value) here. Several call sites deliberately keep
    // reading process.env directly rather than config.x — see the comment at
    // each such call site — because they are proven, by tests that toggle the
    // var mid-suite with no module reset, to need a live (not boot-frozen)
    // read; this schema entry still gives them boot-time validation.
    workBoardAiEnabled: boolFlag(false),
    allowMockAuth: boolFlag(false),
    metricsToken: z.string().optional(),
    deploymentMode: z.preprocess(
        (v) => (v === undefined || v === null || v === '') ? 'self-host' : v,
        z.enum(['self-host', 'saas']),
    ),
    allowLocalAiEndpoints: boolFlag(false),
    disableHttpsEnforcement: boolFlag(false),
    grmDisableWebSetup: boolFlag(false),
    credentialEncryptionKeyPrevious: z.string().optional(),
    // Tri-state, preserved as-is (see server/lib/db-backup.js resolveBackupDir):
    // unset -> undefined (derive default dir), '' -> '' (explicit opt-out),
    // a path -> that path. No default collapses the unset/'' distinction.
    dbBackupDir: z.string().optional(),
    ghCacheMaxAgeDays: z.preprocess(
        (v) => (v === undefined || v === null || v === '') ? 30 : v,
        z.coerce.number().int(),
    ),
    // Docs: "0/empty disables event purging entirely" — unset keeps the
    // shipped-template default (365); an explicit empty string is a distinct
    // operator choice (disable) from "not set at all".
    eventRetentionDays: z.preprocess(
        (v) => (v === undefined || v === null) ? 365 : (v === '' ? 0 : v),
        z.coerce.number().int(),
    ),
    emailRetryBaseDelayMs: z.preprocess(
        (v) => (v === undefined || v === null || v === '') ? 1000 : v,
        z.coerce.number().int(),
    ),
    workBoardSnapshotRetentionDays: z.preprocess(
        (v) => (v === undefined || v === null || v === '') ? 90 : v,
        z.coerce.number().int(),
    ),
    sqliteVerbose: boolFlag(false),
});

function loadConfig() {
    const result = configSchema.safeParse({
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT,
        host: process.env.HOST || undefined,
        sessionSecret: process.env.SESSION_SECRET,
        githubClientId: process.env.GITHUB_CLIENT_ID,
        githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
        frontendUrl: process.env.FRONTEND_URL,
        databaseUrl: process.env.DATABASE_URL,
        redisUrl: process.env.REDIS_URL,
        geminiApiKey: process.env.GEMINI_API_KEY,
        geminiModel: process.env.GEMINI_MODEL,
        geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL,
        // Coerce empty string → undefined so `AI_PROVIDER=` falls back to the default.
        aiProvider: process.env.AI_PROVIDER || undefined,
        sentryDsn: process.env.SENTRY_DSN,
        azurePat: process.env.AZURE_PAT,
        webhookSecret: process.env.WEBHOOK_SECRET,
        licenseKey: process.env.LICENSE_KEY,
        stripeSecretKey: process.env.STRIPE_SECRET_KEY,
        stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        stripePriceProMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
        stripePriceProYearly: process.env.STRIPE_PRICE_PRO_YEARLY,
        stripePriceEnterpriseMonthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
        stripePriceEnterpriseYearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY,
        credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY,
        apiKeySecret: process.env.API_KEY_SECRET,
        emailProvider: process.env.EMAIL_PROVIDER,
        resendApiKey: process.env.RESEND_API_KEY,
        emailFrom: process.env.EMAIL_FROM,
        licenseSigningPrivateKeyPem: process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM,
        dataRetentionDays: process.env.DATA_RETENTION_DAYS,
        dataRetentionWarningLeadDays: process.env.DATA_RETENTION_WARNING_LEAD_DAYS,
        aiRequireUserConfig: process.env.AI_REQUIRE_USER_CONFIG,
        disableAiReview: process.env.DISABLE_AI_REVIEW,
        logLevel: process.env.LOG_LEVEL,
        mockMode: process.env.VITE_MOCK_MODE,

        workBoardAiEnabled: process.env.WORK_BOARD_AI_ENABLED,
        allowMockAuth: process.env.ALLOW_MOCK_AUTH,
        metricsToken: process.env.METRICS_TOKEN,
        deploymentMode: process.env.DEPLOYMENT_MODE,
        allowLocalAiEndpoints: process.env.ALLOW_LOCAL_AI_ENDPOINTS,
        disableHttpsEnforcement: process.env.DISABLE_HTTPS_ENFORCEMENT,
        grmDisableWebSetup: process.env.GRM_DISABLE_WEB_SETUP,
        credentialEncryptionKeyPrevious: process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
        dbBackupDir: process.env.DB_BACKUP_DIR,
        ghCacheMaxAgeDays: process.env.GH_CACHE_MAX_AGE_DAYS,
        eventRetentionDays: process.env.EVENT_RETENTION_DAYS,
        emailRetryBaseDelayMs: process.env.EMAIL_RETRY_BASE_DELAY_MS,
        workBoardSnapshotRetentionDays: process.env.WORK_BOARD_SNAPSHOT_RETENTION_DAYS,
        sqliteVerbose: process.env.SQLITE_VERBOSE,
    });

    if (!result.success) {
        console.error('Invalid configuration:', result.error.format());
        process.exit(1);
    }

    // In production, default log level to 'warn' so info-level chatter doesn't
    // fill disk + Sentry breadcrumbs. Operator can still override via LOG_LEVEL.
    const data = result.data;
    if (data.nodeEnv === 'production' && !process.env.LOG_LEVEL) {
        data.logLevel = 'warn';
    }

    // Operator toggle: set ENV_TOOLING_INSTALL_ENABLED=false to disable the
    // admin-gated /api/env/tooling/:id/install endpoint on hosted deployments.
    data.envToolingInstallEnabled = process.env.ENV_TOOLING_INSTALL_ENABLED !== 'false';

    // Operator toggle: set UPDATE_CHECK=false to disable the outbound GitHub
    // releases fetch behind GET /api/v1/system/update-check entirely.
    data.updateCheckEnabled = process.env.UPDATE_CHECK !== 'false';

    return Object.freeze(data);
}

export const config = loadConfig();
