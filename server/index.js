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
import dotenv from 'dotenv';
dotenv.config();

import db, { initDB, seedMockData } from './db.js';
import { aiService } from './ai-service.js';
import { actionsService } from './actions-service.js';
import { githubApi } from './lib/github-api.js';
import { requireAuth, safeError } from './middleware/auth.js';
import { createSQLiteStore } from './lib/session-store.js';
import logger, { requestLoggerMiddleware } from './lib/logger.js';

// Route modules (existing)
import authRoutes from './routes/auth.js';
import teamsRoutes from './routes/teams.js';
import systemRoutes from './routes/system.js';
import azureRoutes from './routes/azure.js';
import importRoutes from './routes/import.js';
import webhooksRoutes from './routes/webhooks.js';

// Route modules (new)
import reposRoutes from './routes/repos.js';
import orgsRoutes from './routes/orgs.js';
import aiRoutes from './routes/ai.js';
import statsRoutes from './routes/stats.js';
import userRoutes from './routes/user.js';
import bulkRoutes from './routes/bulk.js';

initDB();

// Seed mock data if in mock mode (for demo/development)
if (process.env.VITE_MOCK_MODE !== 'false') {
    seedMockData();
}

const app = express();
const PORT = process.env.PORT || 3001;

// Environment Configuration
const {
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
    SESSION_SECRET = 'dev-secret-change-in-production',
    FRONTEND_URL = 'http://localhost:5173',
    GEMINI_API_KEY,
    WEBHOOK_SECRET
} = process.env;

// Initialize Google AI only if key is present
if (GEMINI_API_KEY) {
    try {
        aiService.initialize(GEMINI_API_KEY);
    } catch (e) {
        logger.error({ err: e }, 'Failed to initialize Google AI');
    }
}

// Enforce SESSION_SECRET in production
if (process.env.NODE_ENV === 'production' && SESSION_SECRET === 'dev-secret-change-in-production') {
    logger.fatal('SESSION_SECRET must be set in production. Exiting.');
    process.exit(1);
}

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    console.warn('⚠️ Warning: GitHub OAuth credentials are missing.');
    console.warn('   OAuth login will not work. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env to enable.');
}

// Middleware Setup
app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
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
    origin: FRONTEND_URL,
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
// Development: higher limits to accommodate React Strict Mode (double-invokes effects)
const isDev = process.env.NODE_ENV !== 'production';
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isDev ? 1000 : 200, // Higher limit in dev for HMR + Strict Mode
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 100 : 20, // Stricter limit for auth endpoints
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please try again later.' }
});
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// Session configuration for secure auth persistence
// In production, sessions are persisted to SQLite so they survive server restarts
// and don't leak memory. In development, the default MemoryStore is used for
// simplicity (no persistence needed, and warnings are acceptable).
const sessionConfig = {
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
};

if (process.env.NODE_ENV === 'production') {
    const SQLiteStore = createSQLiteStore(session);
    sessionConfig.store = new SQLiteStore(db);
}

app.use(session(sessionConfig));

// ------------------------------------------------------------------
// Health check (used by useOnlineStatus for connectivity detection)
// ------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});

// ------------------------------------------------------------------
// Mounted Route Modules
// ------------------------------------------------------------------

// Existing route modules
app.use('/api/auth', authRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/system', systemRoutes);
app.use('/api', azureRoutes);
app.use('/api', importRoutes);
app.use('/api', webhooksRoutes);

// New route modules
app.use('/api/repos', reposRoutes);
app.use('/api/orgs', orgsRoutes);
app.use('/api', aiRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api', userRoutes);
app.use('/api', bulkRoutes);

// ------------------------------------------------------------------
// Team-specific routes (not in teams.js to avoid modifying existing module)
// ------------------------------------------------------------------

// Team Activity Stream
// Aggregates events from all repos assigned to the team
app.get(['/api/teams/:id/activity', '/api/team/:id/activity'], requireAuth, async (req, res) => {
    try {
        // 1. Get Repos assigned to team
        const repos = db.prepare('SELECT repo_full_name FROM repo_assignments WHERE team_id = ?').all(req.params.id);

        if (!repos.length) {
            return res.json([]);
        }

        // 2. Fetch events for each repo (Limit to first 10 repos to avoid rate limits/timeouts)
        // Uses batched fetching (3 at a time) with small delays to avoid rate limit spikes.
        const targetRepos = repos.slice(0, 10);
        const BATCH_SIZE = 3;
        const BATCH_DELAY_MS = 100;
        const results = [];

        for (let i = 0; i < targetRepos.length; i += BATCH_SIZE) {
            const batch = targetRepos.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(
                batch.map(async (r) => {
                    try {
                        const { data } = await githubApi(`/repos/${r.repo_full_name}/events?per_page=10`, req.session.accessToken);
                        return data.map(event => ({ ...event, repo_name: r.repo_full_name }));
                    } catch (e) {
                        console.error(`Failed to fetch events for ${r.repo_full_name}:`, e.message);
                        return [];
                    }
                })
            );
            results.push(...batchResults);

            // Small delay between batches to spread out rate limit usage
            if (i + BATCH_SIZE < targetRepos.length) {
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
        }

        // 3. Flatten, Deduplicate (by id), and Sort by Date
        const allEvents = results.flat();
        const uniqueEvents = Array.from(new Map(allEvents.map(item => [item.id, item])).values());

        uniqueEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // Return top 50
        res.json(uniqueEvents.slice(0, 50));

    } catch (error) {
        console.error('Team Activity Error:', error);
        res.status(500).json({ error: 'Failed to fetch team activity' });
    }
});

// Get statistics for multiple repositories (team view)
app.post('/api/teams/:id/actions/stats', requireAuth, async (req, res) => {
    try {
        const { days = 30 } = req.body;

        const repos = db.prepare('SELECT repo_id, repo_full_name FROM repo_assignments WHERE team_id = ?')
            .all(req.params.id);

        if (repos.length === 0) {
            return res.json({ repos: [], teamAverages: {} });
        }

        const repoIds = repos.map(r => r.repo_id);
        const statsArray = actionsService.getMultiRepoStats(repoIds, parseInt(days));

        const enrichedStats = statsArray.map(stat => {
            const repo = repos.find(r => r.repo_id === stat.repoId);
            return {
                ...stat,
                repoFullName: repo?.repo_full_name || 'unknown'
            };
        });

        const teamAverages = {
            totalRuns: enrichedStats.reduce((sum, s) => sum + s.totalRuns, 0),
            avgSuccessRate: enrichedStats.length > 0
                ? +(enrichedStats.reduce((sum, s) => sum + s.successRate, 0) / enrichedStats.length).toFixed(2)
                : 0,
            avgDuration: enrichedStats.length > 0
                ? Math.round(enrichedStats.reduce((sum, s) => sum + s.avgDuration, 0) / enrichedStats.length)
                : 0
        };

        res.json({ repos: enrichedStats, teamAverages });
    } catch (error) {
        console.error('Get Team Actions Stats Error:', error);
        res.status(500).json({ error: safeError(error, 'Failed to fetch team stats') });
    }
});

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

const server = app.listen(PORT, () => {
    logger.info({ port: PORT, frontend: FRONTEND_URL, mode: process.env.NODE_ENV || 'development' }, 'GitHub Repo Manager API is live');
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        logger.fatal({ port: PORT }, 'Port is already in use');
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
