// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/*
 * B-09 — the per-tenant `ai` rate-limit bucket must reach every LLM-invoking
 * route, not just the /api{,/v1}/ai/* barrel. Two things are verified:
 *
 *   1. server/index.js's mount of AI_BUCKET_EXTRA_EXPRESS_PATHS actually
 *      intercepts real requests to the four known non-barrel routes (both
 *      the back-compat /api/* and /api/v1/* forms), and does NOT intercept
 *      a sibling path outside that list — walked with a real Express app and
 *      supertest, mirroring the barrel's own carve-out parity test
 *      (ai-key-scope-enforcement.test.js).
 *   2. The four route files each still register a handler at the exact path
 *      AI_BUCKET_EXTRA_ROUTE_PATHS expects, and that handler still reaches
 *      guardedGenerate (directly, or through a documented lib/ai-features/*
 *      indirection) — a source scan, so a route rename or a fifth
 *      non-barrel AI route shows up here instead of silently losing rate
 *      limiting.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import {
    AI_BUCKET_EXTRA_ROUTE_PATHS,
    AI_BUCKET_EXTRA_EXPRESS_PATHS,
} from '../middleware/ai-rate-limit-routes.js';

function paramFilledUrl(prefix, routePath) {
    return prefix + routePath.replace(/:owner/g, 'acme').replace(/:repo/g, 'widgets');
}

function makeApp() {
    const hits = [];
    const app = express();
    app.use(AI_BUCKET_EXTRA_EXPRESS_PATHS, (req, _res, next) => {
        hits.push(req.originalUrl);
        next();
    });
    // Stand-in handler for every path this test exercises, matching every
    // method — the point is only whether the limiter middleware ran first.
    app.all(/.*/, (req, res) => res.json({ ok: true, path: req.originalUrl }));
    return { app, hits };
}

describe('B-09: the ai rate-limit bucket reaches the four non-barrel routes', () => {
    it('lists exactly the four known routes', () => {
        expect(AI_BUCKET_EXTRA_ROUTE_PATHS).toEqual([
            '/migration/analyze',
            '/repos/:owner/:repo/agent-rules/generate',
            '/repos/:owner/:repo/security/summary',
            '/work-board/ai-summary',
        ]);
    });

    it('expands to both /api and /api/v1 variants', () => {
        for (const p of AI_BUCKET_EXTRA_ROUTE_PATHS) {
            expect(AI_BUCKET_EXTRA_EXPRESS_PATHS).toContain(`/api${p}`);
            expect(AI_BUCKET_EXTRA_EXPRESS_PATHS).toContain(`/api/v1${p}`);
        }
    });

    it('the limiter middleware runs for every one of the 8 expanded URLs', async () => {
        for (const prefix of ['/api', '/api/v1']) {
            for (const routePath of AI_BUCKET_EXTRA_ROUTE_PATHS) {
                const { app, hits } = makeApp();
                const url = paramFilledUrl(prefix, routePath);
                const res = await request(app).post(url);
                expect(res.status, url).toBe(200);
                expect(hits, url).toEqual([url]);
            }
        }
    });

    it('does NOT run for a sibling AI route path outside the list', async () => {
        const { app, hits } = makeApp();
        await request(app).post('/api/v1/migration/plans');
        await request(app).get('/api/v1/repos/acme/widgets/security');
        expect(hits).toEqual([]);
    });
});

describe('B-09: server/index.js mounts the bucket before the routers handle it', () => {
    it('mounts AI_BUCKET_EXTRA_EXPRESS_PATHS with aiLimiter ahead of v1Routes', () => {
        const src = readFileSync('server/index.js', 'utf8');
        const mountLine = src.indexOf('app.use(AI_BUCKET_EXTRA_EXPRESS_PATHS, aiLimiter)');
        const v1MountLine = src.indexOf("app.use('/api/v1', v1Routes)");
        expect(mountLine, 'the extra-routes mount is missing from index.js').toBeGreaterThan(-1);
        expect(v1MountLine, 'the v1Routes mount moved or was renamed').toBeGreaterThan(-1);
        expect(mountLine, 'the limiter must be registered BEFORE the router that handles the path, or Express never reaches it').toBeLessThan(v1MountLine);
    });
});

describe('B-09: each covered route still lives where the path list expects, and still calls guardedGenerate', () => {
    // file -> [route registration substring, guardedGenerate reachability check]
    const EXPECTATIONS = [
        {
            file: 'server/routes/migration.js',
            routeNeedle: "router.post('/analyze'",
            aiNeedle: 'guardedGenerate(',
        },
        {
            file: 'server/routes/repos/actions-community.js',
            routeNeedle: "router.post('/:owner/:repo/agent-rules/generate'",
            // Indirect: generateAgentRules() in lib/ai-features/agent-rules.js
            // calls guardedGenerate — verified separately below.
            aiNeedle: 'generateAgentRules(',
        },
        {
            file: 'server/routes/v1/repos-security.js',
            routeNeedle: "router.post('/repos/:owner/:repo/security/summary'",
            aiNeedle: 'guardedGenerate(',
        },
        {
            file: 'server/routes/work-board-actions.js',
            routeNeedle: "router.post('/ai-summary'",
            // Indirect: generateSummary() in lib/work-board-summary.js calls
            // provider.generate() under its own manual spend-cap pair
            // (checkAISpendCap/recordAISpend) rather than guardedGenerate —
            // verified separately below.
            aiNeedle: 'generateSummary(',
        },
    ];

    for (const { file, routeNeedle, aiNeedle } of EXPECTATIONS) {
        it(`${file} still registers the route and reaches an LLM call`, () => {
            const src = readFileSync(file, 'utf8');
            expect(src, `${routeNeedle} not found in ${file}`).toContain(routeNeedle);
            expect(src, `${aiNeedle} not found in ${file}`).toContain(aiNeedle);
        });
    }

    it('the agent-rules indirection actually reaches guardedGenerate', () => {
        const src = readFileSync('server/lib/ai-features/agent-rules.js', 'utf8');
        expect(src).toContain('export async function generateAgentRules');
        expect(src).toContain('guardedGenerate(');
    });

    it('the work-board-summary indirection actually calls the AI provider', () => {
        const src = readFileSync('server/lib/work-board-summary.js', 'utf8');
        expect(src).toContain('export async function generateSummary');
        expect(src).toContain('provider.generate(');
    });
});
