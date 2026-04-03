import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const configSchema = z.object({
    // Server
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    port: z.coerce.number().default(3001),

    // Session
    sessionSecret: z.string().default('dev-secret-change-in-production'),

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

    // Azure DevOps (optional)
    azurePat: z.string().optional(),

    // Webhooks (optional)
    webhookSecret: z.string().optional(),

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
        azurePat: process.env.AZURE_PAT,
        webhookSecret: process.env.WEBHOOK_SECRET,
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
