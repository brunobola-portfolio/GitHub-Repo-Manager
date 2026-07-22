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
import compression from 'compression';
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
import { recoverInterruptedImportJobs } from './routes/import/_shared.js';
import { config } from './config.js';
import { initMonitoring, getSentryErrorHandler } from './lib/monitoring.js';
import db, { initDB, seedMockData } from './db.js';
import { DBSchemaFromFutureError } from './lib/db-migrations.js';
import { aiService } from './ai-service.js';
import { safeError, attachAIProvider } from './middleware/auth.js';
import { createSQLiteStore } from './lib/session-store.js';
import logger, { requestLoggerMiddleware } from './lib/logger.js';
import { requestTiming } from './middleware/request-timing.js';
import { metricsMiddleware } from './lib/metrics.js';
import { verifySecretsAtStartup } from './lib/startup-secrets-check.js';
import { startWorkBoardSweeper, stopWorkBoardSweeper, startKpiSnapshotJob, stopKpiSnapshotJob } from './lib/work-board-sweeper.js';
import { startEmailRetryWorker, stopEmailRetryWorker } from './lib/email-retry-worker.js';
import { startWebhookRetryWorker, stopWebhookRetryWorker } from './lib/webhook-retry-worker.js';
import { startGhOutboxWorker, stopGhOutboxWorker } from './lib/gh-outbox.js';
import { startMaintenanceJanitors, stopMaintenanceJanitors } from './lib/maintenance-janitors.js';
import { createSessionTokenLookup } from './lib/session-token-lookup.js';
import { registerShutdown, requestShutdown } from './lib/shutdown.js';
import { isManaged, initManagedRuntime, clearManagedRuntime } from './lib/managed-runtime.js';
import { getDataDir } from './lib/data-dir.js';
import { resolveIntentOnBoot } from './lib/updater.js';

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

try {
    initDB();
} catch (error) {
    if (error instanceof DBSchemaFromFutureError) {
        // start.ps1's failure dialog points users at the log — this line is
        // the whole story they need, so it must not be a raw stack trace.
        logger.fatal({ dbVersion: error.dbVersion, appVersion: error.appVersion }, error.message);
        process.exit(1);
    }
    throw error;
}

// Warm the license cache now that the schema exists. This used to fire at
// require-tier.js's module-load time — but ESM import evaluation runs before
// this file's own body (including the initDB() call above), so on a
// genuinely empty database it queried `installed_license` before initDB()
// had created it. That was invisible in practice (every long-lived dev/prod
// DB already has the full schema from prior boots) until the Windows
// package made a truly fresh DB the NORMAL first-launch case. Test envs
// skip this so unit tests can call refreshLicenseCache() explicitly against
// a controlled DB state.
import { refreshLicenseCache, getLicenseSource, attachTier } from './middleware/require-tier.js';
if (config.nodeEnv !== 'test') {
    refreshLicenseCache().then((payload) => {
        if (payload) {
            logger.info(
                { tier: payload.tier, org: payload.org || 'N/A', source: getLicenseSource(),
                    expires: payload.exp ? new Date(payload.exp * 1000).toISOString().split('T')[0] : 'never' },
                'License validated'
            );
        }
    }).catch((err) => {
        // A DB failure here silently degrades the server to the free tier with no
        // signal. Log it so a misconfigured deploy is diagnosable.
        logger.warn({ err }, 'Failed to warm license cache at startup; serving default tier until next refresh');
    });
}

// Seed mock data only when explicitly enabled (for demo/development)
if (config.mockMode === 'true') {
    seedMockData();
}

const app = express();

// Trust first proxy (Nginx, Cloudflare, Railway) for correct client IP in rate limiting
if (config.nodeEnv === 'production') {
    app.set('trust proxy', 1);
}

// Initialize the configured AI provider (Gemini by default; honors AI_PROVIDER).
const _aiProvider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
if (config.geminiApiKey || _aiProvider !== 'gemini') {
    try {
        await aiService.initialize(config.geminiApiKey);
    } catch (e) {
        logger.error({ err: e }, 'Failed to initialize AI provider');
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

// Response compression — mounted early so it wraps every downstream response
// (static assets + JSON). The filter skips Server-Sent Events so streamed
// chunks flush to the client immediately instead of being buffered by the
// gzip transform (compression's default filter already excludes
// text/event-stream, but we assert it explicitly for clarity + safety).
app.use(compression({
    filter: (req, res) => {
        if (res.getHeader('Content-Type') === 'text/event-stream') return false;
        return compression.filter(req, res);
    },
}));

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
// Prometheus request-duration/in-flight instrumentation — mounted this early
// so every request (including ones that never reach an /api/ route) is
// counted. See server/lib/metrics.js for the route-label normalization.
app.use(metricsMiddleware);
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

// The global JSON cap stays tight (10kb) to keep the attack surface small.
// AI review endpoints (PR review-summary, deep-review, pr-commands, pr-chat)
// legitimately receive concatenated diff/patch payloads that far exceed 10kb,
// so they get a larger limit. These routes are authenticated and rate-limited,
// which bounds the abuse risk of the higher cap.
const jsonDefault = express.json({ limit: '10kb' });
const jsonAiLarge = express.json({ limit: '4mb' });
// The AI router is mounted at BOTH /api/ai/* (legacy alias) and /api/v1/ai/*,
// so the large-body carve-out must match both prefixes — otherwise a diff/patch
// payload posted to the v1 path is rejected at the 10kb default cap.
const isAiPath = (p) => p.startsWith('/api/ai/') || p.startsWith('/api/v1/ai/');
app.use((req, res, next) =>
    isAiPath(req.path)
        ? jsonAiLarge(req, res, next)
        : jsonDefault(req, res, next)
);
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
        // 'auto': Secure only when the request actually arrived over TLS
        // (req.secure — which, with `trust proxy` set above, honours the
        // X-Forwarded-Proto a TLS-terminating proxy like the documented
        // Caddy setup sends). The previous `nodeEnv === 'production'` flag
        // refused to set the cookie AT ALL for the Windows package (a
        // production build served over plain http://127.0.0.1): no session
        // ⇒ no oauthState across the GitHub redirect ⇒ login always died
        // with invalid_state, and no CSRF token ever matched. Loopback
        // traffic never crosses a wire, so a non-Secure cookie there gives
        // up nothing; hosted HTTPS deployments still get Secure cookies.
        secure: config.nodeEnv === 'production' ? 'auto' : false,
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

// Prometheus scrape endpoint — outside /api/* (see routes/metrics.js for
// why), mounted after session() so the admin-session half of its auth gate
// (metricsAuth -> requireAdmin) has req.session available.
import metricsRouter from './routes/metrics.js';
app.use('/metrics', metricsRouter);

// Absolute session timeout (7 days from initial login) — runs right after
// the session middleware so expired sessions never reach any route handler.
import { sessionAbsoluteTimeout } from './middleware/session-absolute-timeout.js';
app.use('/api/', sessionAbsoluteTimeout);

// CSRF enforcement on all /api/* mutations. Skips GET/HEAD/OPTIONS and
// bypasses the OAuth flow + signature-verified webhooks (see csrf.js).
import { requireCsrfToken } from './middleware/csrf.js';
app.use('/api/', requireCsrfToken);

// Attach user tier after session (for rate limiting and feature gating)
app.use('/api/', attachTier);

// Attach BYOK AI provider (lazy) — makes req.getAIProvider(kind) available on
// all /api/* requests and shims req.aiProvider / req.genAI for legacy call-sites.
app.use('/api/', attachAIProvider());

// Per-tenant limiters AFTER session + tier attachment so req.userTier is available
const apiLimiter  = await createTenantLimiters('api');
const authLimiter = await createTenantLimiters('auth', {
    // /api/auth/session is an idempotent polled read, not a brute-force target.
    // Letting it flow through the general apiLimiter keeps dev HMR from exhausting
    // the tight auth budget.
    skip: (req) => req.path === '/session',
});
// The per-tier 'ai' bucket (tenant-rate-limit.js) was defined but never
// instantiated/mounted — every LLM-invoking route relied solely on the
// broader apiLimiter above. Scoped to the ai.js barrel's routes, reachable at
// both the back-compat `/api/ai/*` path and the `/api/v1/ai/*` path (both
// map to the same router — see routes/ai.js and routes/v1/index.js).
const aiLimiter = await createTenantLimiters('ai');
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/ai/', aiLimiter);
app.use('/api/v1/ai/', aiLimiter);

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

// Env tooling routes (admin-gated; must be after session + CSRF middleware)
import envRouter from './routes/env.js';
app.use('/api/env', envRouter);

// API v1 routes
// NOTE: these two mount prefixes are hardcoded into the ai-scope carve-out
// Set in middleware/api-key-auth.js (AI_GENERATION_ROUTES builds `/api${p}`
// + `/api/v1${p}`) — remounting the AI routes under a new prefix (e.g.
// /api/v2) without updating that Set makes ai-only keys fail closed (403)
// on the new prefix.
app.use('/api/v1', v1Routes);
// Backward compatibility: /api/* maps to /api/v1/*
app.use('/api', v1Routes);

// Serve frontend in production
if (config.nodeEnv === 'production') {
    const distPath = path.join(__dirname, '..', 'dist');
    if (fs.existsSync(distPath)) {
        // Vite content-hashes filenames under /assets (e.g. index-a1b2c3.js), so
        // those are safe to cache forever (immutable). Everything else — most
        // importantly index.html, whose asset references change every deploy —
        // must revalidate, so we send no-cache for it. index:false makes '/'
        // fall through to the SPA fallback below, which serves index.html with
        // the correct no-cache header.
        app.use(express.static(distPath, {
            index: false,
            setHeaders: (res, filePath) => {
                if (/[/\\]assets[/\\]/.test(filePath)) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                } else {
                    res.setHeader('Cache-Control', 'no-cache');
                }
            },
        }));
        // SPA fallback. Express 5 / path-to-regexp v8 reject a bare '*' at
        // registration ("Missing parameter name") — the named splat form is
        // required, or the whole production process crashes before listen().
        app.get('/{*splat}', (req, res) => {
            if (req.path.startsWith('/api/')) {
                return res.status(404).json({ error: 'Not found' });
            }
            // Never cache the app shell — it must always pick up the latest
            // hashed asset references after a deploy.
            res.setHeader('Cache-Control', 'no-cache');
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

// HOST is optional — passing it to listen() binds a single interface (the
// Windows package sets 127.0.0.1 so the firewall prompt never appears and the
// server isn't LAN-exposed by default). Omitting it preserves the historical
// behavior of binding all interfaces.
function onListening() {
    logger.info({ port: config.port, host: config.host || '0.0.0.0 (all interfaces)', frontend: config.frontendUrl, mode: config.nodeEnv }, 'GitHub Repo Manager API is live');
    if (isManaged()) {
        // Must run before initManagedRuntime: a boot that follows an
        // apply-update.ps1 handoff needs its intent marker reconciled (and
        // the resulting success/failure recorded for /api/system/status)
        // before anything else about this boot is logged.
        const outcome = resolveIntentOnBoot(getDataDir(), pkg.version);
        if (outcome !== 'none') {
            logger.info({ outcome, version: pkg.version }, '[managed] update intent resolved');
        }
        initManagedRuntime(getDataDir());
        logger.info('[managed] shutdown token ready');
    }
}
const server = config.host
    ? app.listen(config.port, config.host, onListening)
    : app.listen(config.port, onListening);

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

// Start data-lifecycle janitors: the 365-day AI-credential retention pass (the
// auto-deletion users are emailed a promise about) + gh_cache / gh_outbox /
// undo-log purges. Written + tested previously but never scheduled — only the
// manual CLI ran them. See server/lib/maintenance-janitors.js.
startMaintenanceJanitors();

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

// Recover single-repo import jobs orphaned by a hard crash. Graceful shutdown
// marks these 'interrupted', but a crash (OOM/SIGKILL) bypasses it — and unlike
// migration plans these have no task model to resume, so mark any non-terminal
// job 'interrupted' to unblock re-import (the dedup check skips terminal jobs)
// and surface the state instead of stalling at 'running' forever.
try {
    const { recovered } = recoverInterruptedImportJobs();
    if (recovered > 0) logger.info({ count: recovered }, 'recovered orphaned import jobs on startup');
} catch (err) {
    logger.error({ err }, 'import-job startup recovery failed');
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

// After signalling shutdown we give in-flight requests a brief window to drain
// naturally, then force-close whatever is left (long-lived SSE streams never
// finish on their own) so server.close()'s callback fires and we exit cleanly
// instead of hitting the hard force-exit(1) below.
const SHUTDOWN_DRAIN_MS = 3000;

function gracefulShutdown(signal) {
    logger.info({ signal }, 'Shutting down gracefully...');

    // Flip the liveness probe to "shutting_down" immediately so orchestrators
    // drain traffic before we close the listening socket. Imported lazily to
    // avoid a second top-level import line for a single-use hook.
    import('./routes/health.js')
        .then(({ markShuttingDown }) => markShuttingDown())
        .catch((err) => logger.warn({ err }, 'Could not flag health probe as shutting down'));

    server.close(async () => {
        try {
            // Mark in-flight import jobs as interrupted. Jobs use 'running'/'pending'
            // (not 'in_progress') — the old clause matched nothing and left them stuck.
            db.prepare("UPDATE migration_jobs SET status = 'interrupted' WHERE status IN ('running', 'pending')").run();
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
            stopMaintenanceJanitors();
        } catch (e) {
            logger.warn({ err: e }, 'Could not stop maintenance janitors');
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

        if (isManaged()) {
            clearManagedRuntime(getDataDir());
        }

        logger.info('Server shut down complete');
        process.exit(0);
    });

    // Free idle keep-alive sockets immediately so normal (finished) requests
    // don't hold the listening socket open (Node >= 18.2).
    if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
    }

    // SSE streams (AI streaming, migration progress, env-tool install) keep a
    // request in-flight indefinitely, so server.close() would otherwise wait on
    // them until the 10s force-exit(1) — closing the DB uncleanly mid-WAL and
    // making orchestrators log the deploy as a crash. After a short drain
    // window, force-close everything still open so the close callback runs and
    // we exit(0) cleanly. closeAllConnections() (Node >= 18.2) is transport
    // level, so it covers every SSE endpoint regardless of how it was opened.
    const drainTimer = setTimeout(() => {
        if (typeof server.closeAllConnections === 'function') {
            logger.info('Draining remaining connections (open SSE streams) for shutdown');
            server.closeAllConnections();
        }
    }, SHUTDOWN_DRAIN_MS);
    if (drainTimer.unref) drainTimer.unref();

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

registerShutdown(gracefulShutdown);
process.on('SIGTERM', () => requestShutdown('SIGTERM'));
process.on('SIGINT', () => requestShutdown('SIGINT'));

// Backstop unhandled promise rejections (e.g. a fire-and-forget import/migration
// write that throws). Since Node 15 the default is to TERMINATE the process on an
// unhandled rejection — which would drop every in-flight request. Log loudly and
// keep serving instead; the stray rejection is a bug to fix, not a reason to crash.
process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection (backstopped — investigate)');
});
