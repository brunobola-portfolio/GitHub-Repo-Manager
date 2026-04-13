import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

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
    stripePriceEnterpriseMonthly: z.string().optional(),

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
        stripePriceEnterpriseMonthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
        mockMode: process.env.VITE_MOCK_MODE,
    });

    if (!result.success) {
        console.error('Invalid configuration:', result.error.format());
        process.exit(1);
    }

    return Object.freeze(result.data);
}

export const config = loadConfig();
