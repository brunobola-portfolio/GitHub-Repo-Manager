/*
 * GitHub Repo Manager - Backend Server
 *
 * Built with Express.js, this server handles GitHub OAuth authentication
 * and acts as a secure proxy for GitHub API operations.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import session from 'express-session';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createTenantLimiters, globalLimiter } from './middleware/tenant-rate-limit.js';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

import { closeAllQueues } from './lib/queue.js';
import { engine as migrationEngine } from './routes/migration.js';
import { config } from './config.js';
import { initMonitoring, getSentryErrorHandler } from './lib/monitoring.js';
import db, { initDB, seedMockData } from './db.js';
import { aiService } from './ai-service.js';
import { safeError } from './middleware/auth.js';
import { createSQLiteStore } from './lib/session-store.js';
import logger, { requestLoggerMiddleware } from './lib/logger.js';
import { requestTiming } from './middleware/request-timing.js';
import { verifySecretsAtStartup } from './lib/startup-secrets-check.js';
import { startWorkBoardSweeper, stopWorkBoardSweeper, startKpiSnapshotJob, stopKpiSnapshotJob } from './lib/work-board-sweeper.js';
import { startEmailRetryWorker, stopEmailRetryWorker } from './lib/email-retry-worker.js';
import { startWebhookRetryWorker, stopWebhookRetryWorker } from './lib/webhook-retry-worker.js';
import { startGhOutboxWorker, stopGhOutboxWorker } from './lib/gh-outbox.js';
import { createSessionTokenLookup } from './lib/session-token-lookup.js';

// API v1 route aggregator
import v1Routes from './routes/v1/index.js';

// Initialize monitoring before anything else
await initMonitoring();

// G4 — Startup secrets verification (SOC 2 CC6.1)
// Must run before initDB() so that encryption-key checks happen before any
// user credentials are accessed from the database.
{
    const secretsReport = verifySecretsAtStartup({ nodeEnv: config.nodeEnv });
    if (secretsReport.errors.length > 0) {
        secretsReport.errors.forEach(e => logger.fatal(`[secrets] ${e}`));
        process.exit(1);
    }
    secretsReport.warnings.forEach(w => logger.warn(`[secrets] ${w}`));
}

initDB();

// Seed mock data only when explicitly enabled (for demo/development)
if (config.mockMode === 'true') {
    seedMockData();
}

const app = express();

// Trust first proxy (Nginx, Cloudflare, Railway) for correct client IP in rate limiting
if (config.nodeEnv === 'production') {
    app.set('trust proxy', 1);
}

// Initialize Google AI only if key is present
if (config.geminiApiKey) {
    try {
        aiService.initialize(config.geminiApiKey);
    } catch (e) {
        logger.error({ err: e }, 'Failed to initialize Google AI');
    }
}

// Enforce SESSION_SECRET in production
const WEAK_DEFAULTS = ['CHANGE_THIS_SECRET', 'change-this-to-a-random-string'];
if (config.nodeEnv === 'production' && WEAK_DEFAULTS.includes(config.sessionSecret)) {
    logger.fatal('SESSION_SECRET must be set in production. Exiting.');
    process.exit(1);
}

if (config.nodeEnv !== 'production' && WEAK_DEFAULTS.includes(config.sessionSecret)) {
    logger.warn('Using default session secret. Set SESSION_SECRET environment variable for deployment.');
} else if (config.sessionSecret.length < 32) {
    logger.warn('SESSION_SECRET is shorter than 32 characters. Use a longer, random secret for better security.');
}

// Enforce API_KEY_SECRET in production
if (config.nodeEnv === 'production' && !process.env.API_KEY_SECRET) {
    logger.fatal('API_KEY_SECRET must be set in production. Exiting.');
    process.exit(1);
}
if (config.nodeEnv !== 'production' && !process.env.API_KEY_SECRET) {
    logger.warn('Using default API key secret. Set API_KEY_SECRET environment variable for deployment.');
}

if (!config.githubClientId || !config.githubClientSecret) {
    logger.warn('GitHub OAuth credentials missing. OAuth login will not work. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env to enable.');
}

// Request ID tracing
app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
});

// Middleware Setup
app.use(helmet({
    contentSecurityPolicy: config.nodeEnv === 'production' ? {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https://github.com", "https://avatars.githubusercontent.com", "https://*.githubusercontent.com"],
            connectSrc: ["'self'", config.frontendUrl],
        }
    } : false,
    crossOriginEmbedderPolicy: false,
    hsts: config.nodeEnv === 'production' ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
}));
app.use(cors({
    origin: config.nodeEnv === 'production' ? config.frontendUrl : true,
    credentials: true,
}));
// Per-request timing — mounted before session so we time the full request
// lifecycle including session hydration, rate limiting, and the handler.
app.use(requestTiming);
// Stripe webhooks need raw body (must be before express.json())
import { stripeWebhookHandler } from './routes/stripe-webhooks.js';
app.post('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);
// GitHub Actions webhooks need raw body for HMAC signature verification
import { actionsWebhookHandler } from './routes/webhooks.js';
app.post('/api/v1/webhooks/actions', express.raw({ type: 'application/json' }), actionsWebhookHandler);
app.post('/api/webhooks/actions', express.raw({ type: 'application/json' }), actionsWebhookHandler);
// GitHub event ingestion pipeline (Phase E1) — PR, issues, deployments
import { githubEventsWebhookHandler } from './routes/github-events-webhook.js';
app.post('/api/v1/webhooks/github', express.raw({ type: 'application/json' }), githubEventsWebhookHandler);
app.post('/api/webhooks/github', express.raw({ type: 'application/json' }), githubEventsWebhookHandler);

app.use(express.json({ limit: '10kb' }));
app.use(requestLoggerMiddleware);

// Cap per_page query parameter to prevent excessive data requests
app.use('/api/', (req, _res, next) => {
    if (req.query.per_page) {
        const parsed = parseInt(req.query.per_page);
        req.query.per_page = String(Math.min(Math.max(parsed || 30, 1), 100));
    }
    next();
});

// Health probes must be mounted BEFORE rate limiters, session, CSRF, etc.
// K8s-style probes fire frequently and must succeed even under load; they
// must not require auth, must not be rate-limited, and must keep working
// while the rest of the stack is degraded (Redis down, session store
// unavailable, etc.). Legacy GET /api/health below is preserved separately.
import healthRouter from './routes/health.js';
app.use('/api/health', healthRouter);

// Rate limiting for API endpoints
// Per-tenant limits (free / pro / enterprise) backed by Redis when REDIS_URL is set.
// Falls back to in-process MemoryStore for self-hosted / development.
// The global safety-net limiter runs pre-session; per-tenant limiters use
// req.userTier (populated by auth middleware) and fall back to the "free" tier.
const isDev = config.nodeEnv !== 'production';

// Global safety-net: caps anonymous / pre-session traffic
// (higher ceiling in dev to accommodate React Strict Mode double-invokes)
const devSafetyNet = isDev
    ? rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false })
    : globalLimiter;
app.use('/api/', devSafetyNet);

// Session configuration for secure auth persistence
// Store selection priority:
//   1. Redis (REDIS_URL set)  → distributed sessions for multi-instance deployments
//   2. SQLite                 → default for development AND production (persistent)
//   3. MemoryStore            → only for NODE_ENV=test (non-persistent, intentional)
const sessionConfig = {
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    // rolling: re-set the cookie expiry on every response that touches the
    // session, so an active user stays logged in indefinitely. The absolute
    // ceiling is enforced separately by sessionAbsoluteTimeout middleware.
    rolling: true,
    cookie: {
        secure: config.nodeEnv === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours — refreshed on every request
    }
};

if (config.redisUrl) {
    const { createRedisStore } = await import('./lib/session-store-redis.js');
    const { store } = createRedisStore();
    sessionConfig.store = store;
    logger.info('[sessions] Using Redis session store');
} else if (config.nodeEnv !== 'test') {
    // Development AND production both use the SQLite-backed store so dev
    // restarts don't drop user sessions. Tests fall through to the in-memory
    // default (intentional — each test should start with a clean slate).
    const SQLiteStore = createSQLiteStore(session);
    sessionConfig.store = new SQLiteStore(db);
    logger.info('[sessions] Using SQLite session store');
}

app.use(session(sessionConfig));

// Absolute session timeout (7 days from initial login) — runs right after
// the session middleware so expired sessions never reach any route handler.
import { sessionAbsoluteTimeout } from './middleware/session-absolute-timeout.js';
app.use('/api/', sessionAbsoluteTimeout);

// CSRF enforcement on all /api/* mutations. Skips GET/HEAD/OPTIONS and
// bypasses the OAuth flow + signature-verified webhooks (see csrf.js).
import { requireCsrfToken } from './middleware/csrf.js';
app.use('/api/', requireCsrfToken);

// Attach user tier after session (for rate limiting and feature gating)
import { attachTier } from './middleware/require-tier.js';
app.use('/api/', attachTier);

// Attach BYOK AI provider (lazy) — makes req.getAIProvider(kind) available on
// all /api/* requests and shims req.aiProvider / req.genAI for legacy call-sites.
import { attachAIProvider } from './middleware/auth.js';
app.use('/api/', attachAIProvider());

// Per-tenant limiters AFTER session + tier attachment so req.userTier is available
const apiLimiter  = await createTenantLimiters('api');
const authLimiter = await createTenantLimiters('auth', {
    // /api/auth/session is an idempotent polled read, not a brute-force target.
    // Letting it flow through the general apiLimiter keeps dev HMR from exhausting
    // the tight auth budget.
    skip: (req) => req.path === '/session',
});
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// ------------------------------------------------------------------
// Health check (used by useOnlineStatus for connectivity detection)
// ------------------------------------------------------------------
const startTime = Date.now();
app.get('/api/health', (_req, res) => {
    const health = {
        status: 'ok',
        version: pkg.version,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        database: 'connected',
    };
    try {
        db.prepare('SELECT 1').get();
    } catch {
        health.database = 'disconnected';
        health.status = 'degraded';
    }
    if (config.redisUrl) {
        health.redis = 'configured';
    }
    res.json(health);
});

// ------------------------------------------------------------------
// Mounted Route Modules
// ------------------------------------------------------------------

// API v1 routes
app.use('/api/v1', v1Routes);
// Backward compatibility: /api/* maps to /api/v1/*
app.use('/api', v1Routes);

// Serve frontend in production
if (config.nodeEnv === 'production') {
    const distPath = path.join(__dirname, '..', 'dist');
    if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
            if (req.path.startsWith('/api/')) {
                return res.status(404).json({ error: 'Not found' });
            }
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }
}

// -----------------------------------------------------------------------------
// Error Tracking (Sentry)
// -----------------------------------------------------------------------------

app.use(getSentryErrorHandler());

// -----------------------------------------------------------------------------
// Global Error Handler
// -----------------------------------------------------------------------------

app.use((err, req, res, _next) => {
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    res.status(err.status || 500).json({
        error: safeError(err, 'An internal error occurred')
    });
});

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------

const server = app.listen(config.port, () => {
    logger.info({ port: config.port, frontend: config.frontendUrl, mode: config.nodeEnv }, 'GitHub Repo Manager API is live');
});

// Start background sweeper for Work Board cache + snooze TTL cleanup
startWorkBoardSweeper();
startKpiSnapshotJob();

// Start background worker that re-drives the email dead-letter queue
startEmailRetryWorker();

// Start background worker that re-drives the GitHub webhook dead-letter queue
startWebhookRetryWorker();

// Start background worker that re-drives the gh-outbox (queued mutations like
// PR comments / merges that landed in the outbox when GitHub was down).
// Token lookup scans the active sessions table for the latest accessToken
// belonging to the row's user_id — see server/lib/session-token-lookup.js
// for the SQLite/Redis caveats.
startGhOutboxWorker({ tokenLookup: createSessionTokenLookup(db) });

// Recover migration plans orphaned by a previous crash/restart: any plan left
// 'running' in the DB has no live execution loop now, so reset its in-flight
// tasks and auto-resume (when credentials are still available) or mark it
// 'interrupted' for a manual resume. Guarded so a recovery hiccup never blocks
// the server from coming up.
try {
    migrationEngine.recoverInterruptedPlans();
} catch (err) {
    logger.error({ err }, 'migration-engine: startup recovery failed');
}

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        logger.fatal({ port: config.port }, 'Port is already in use');
        process.exit(1);
    } else {
        logger.error({ err: e }, 'Server error');
    }
});

// ------------------------------------------------------------------
// Graceful Shutdown
// ------------------------------------------------------------------

function gracefulShutdown(signal) {
    logger.info({ signal }, 'Shutting down gracefully...');

    // Flip the liveness probe to "shutting_down" immediately so orchestrators
    // drain traffic before we close the listening socket. Imported lazily to
    // avoid a second top-level import line for a single-use hook.
    import('./routes/health.js').then(({ markShuttingDown }) => markShuttingDown()).catch(() => {});

    server.close(async () => {
        try {
            // Mark in-flight import jobs as interrupted
            db.prepare("UPDATE migration_jobs SET status = 'interrupted' WHERE status = 'in_progress'").run();
        } catch (e) {
            // Table may not exist in all environments
            logger.warn({ err: e }, 'Could not update migration jobs');
        }

        try {
            // Mark in-flight migration plans and tasks as interrupted
            db.prepare(`UPDATE migration_plans SET status = 'interrupted', updated_at = datetime('now')
                WHERE status IN ('running', 'paused')`).run();
            db.prepare(`UPDATE migration_tasks SET status = 'interrupted'
                WHERE status IN ('pending', 'running')`).run();
        } catch (e) {
            logger.warn({ err: e }, 'Could not update migration plans/tasks');
        }

        try {
            stopWorkBoardSweeper();
        } catch (e) {
            logger.warn({ err: e }, 'Could not stop work-board sweeper');
        }

        try {
            stopKpiSnapshotJob();
        } catch (e) {
            logger.warn({ err: e }, 'Could not stop KPI snapshot job');
        }

        try {
            stopEmailRetryWorker();
        } catch (e) {
            logger.warn({ err: e }, 'Could not stop email retry worker');
        }

        try {
            stopWebhookRetryWorker();
        } catch (e) {
            logger.warn({ err: e }, 'Could not stop webhook retry worker');
        }

        try {
            stopGhOutboxWorker();
        } catch (e) {
            logger.warn({ err: e }, 'Could not stop gh-outbox worker');
        }

        try {
            await closeAllQueues();
        } catch (e) {
            logger.warn({ err: e }, 'Could not close queues');
        }

        try {
            migrationEngine.destroy();
        } catch (e) {
            logger.warn({ err: e }, 'Could not destroy migration engine');
        }

        try {
            db.close();
        } catch (e) {
            logger.warn({ err: e }, 'Could not close database');
        }

        logger.info('Server shut down complete');
        process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
