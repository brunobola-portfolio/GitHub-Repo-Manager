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

import { config } from './config.js';
import { initMonitoring, getSentryErrorHandler } from './lib/monitoring.js';
import db, { initDB, seedMockData } from './db.js';
import { aiService } from './ai-service.js';
import { safeError } from './middleware/auth.js';
import { createSQLiteStore } from './lib/session-store.js';
import logger, { requestLoggerMiddleware } from './lib/logger.js';

// API v1 route aggregator
import v1Routes from './routes/v1/index.js';

// Initialize monitoring before anything else
await initMonitoring();

initDB();

// Seed mock data only when explicitly enabled (for demo/development)
if (config.mockMode === 'true') {
    seedMockData();
}

const app = express();

// Initialize Google AI only if key is present
if (config.geminiApiKey) {
    try {
        aiService.initialize(config.geminiApiKey);
    } catch (e) {
        logger.error({ err: e }, 'Failed to initialize Google AI');
    }
}

// Enforce SESSION_SECRET in production
if (config.nodeEnv === 'production' && config.sessionSecret === 'dev-secret-change-in-production') {
    logger.fatal('SESSION_SECRET must be set in production. Exiting.');
    process.exit(1);
}

if (config.nodeEnv !== 'production' && config.sessionSecret === 'dev-secret-change-in-production') {
    logger.warn('Using default session secret. Set SESSION_SECRET environment variable for deployment.');
} else if (config.sessionSecret.length < 32) {
    logger.warn('SESSION_SECRET is shorter than 32 characters. Use a longer, random secret for better security.');
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
            connectSrc: ["'self'"],
        }
    } : false,
    crossOriginEmbedderPolicy: false // Allow embedded resources
}));
app.use(cors({
    origin: config.frontendUrl,
    credentials: true
}));
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

// Per-tenant limiters (tier-aware, Redis-backed when available)
const apiLimiter  = await createTenantLimiters('api');
const authLimiter = await createTenantLimiters('auth');
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// Session configuration for secure auth persistence
// Store selection priority:
//   1. Redis (REDIS_URL set)  → distributed sessions for multi-instance deployments
//   2. SQLite (production)    → single-instance persistent sessions
//   3. MemoryStore (default)  → development only (non-persistent, acceptable)
const sessionConfig = {
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: config.nodeEnv === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
};

if (config.redisUrl) {
    const { createRedisStore } = await import('./lib/session-store-redis.js');
    const { store } = createRedisStore();
    sessionConfig.store = store;
    logger.info('[sessions] Using Redis session store');
} else if (config.nodeEnv === 'production') {
    const SQLiteStore = createSQLiteStore(session);
    sessionConfig.store = new SQLiteStore(db);
    logger.info('[sessions] Using SQLite session store');
}

app.use(session(sessionConfig));

// ------------------------------------------------------------------
// Health check (used by useOnlineStatus for connectivity detection)
// ------------------------------------------------------------------
const startTime = Date.now();
app.get('/api/health', (_req, res) => {
    const health = {
        status: 'ok',
        version: '2.5.0',
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

    server.close(() => {
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
