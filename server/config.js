import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const configSchema = z.object({
    // Server
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    port: z.coerce.number().default(3001),

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
});

function loadConfig() {
    const result = configSchema.safeParse({
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT,
        sessionSecret: process.env.SESSION_SECRET,
        githubClientId: process.env.GITHUB_CLIENT_ID,
        githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
        frontendUrl: process.env.FRONTEND_URL,
        databaseUrl: process.env.DATABASE_URL,
        redisUrl: process.env.REDIS_URL,
        geminiApiKey: process.env.GEMINI_API_KEY,
        geminiModel: process.env.GEMINI_MODEL,
        geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL,
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

    return Object.freeze(data);
}

export const config = loadConfig();
