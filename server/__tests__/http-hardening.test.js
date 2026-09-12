// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { buildHelmetOptions, permissionsPolicy, noStoreApi } from '../lib/http-hardening.js';

/*
 * These assertions run against the same exported options object and the same
 * middleware functions server/index.js boots with, so they describe the real
 * deployment rather than a re-declaration of it. The headers they pin are the
 * ones nothing else covers: the framing pair (which must agree), HSTS, and the
 * cache policy on API answers.
 */
const appFor = (nodeEnv) => {
    const app = express();
    app.use(helmet(buildHelmetOptions({ nodeEnv, frontendUrl: 'https://repomanager.example.pt' })));
    app.use(permissionsPolicy);
    app.use('/api/', noStoreApi);
    app.get('/api/me', (_req, res) => res.json({ ok: true }));
    // Mirrors server/routes/ai-streaming.js initSSE: writeHead wins over an
    // earlier setHeader, so a stream keeps its own directive.
    app.get('/api/stream', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.end('data: 1\n\n');
    });
    app.get('/', (_req, res) => res.type('html').send('<html></html>'));
    return app;
};

describe('framing is denied by both headers, in both environments', () => {
    it('sends X-Frame-Options DENY and frame-ancestors none in production', async () => {
        const res = await request(appFor('production')).get('/');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    });

    it('still denies framing when the CSP is off (development)', async () => {
        // The CSP is production-only, so outside production this legacy header
        // is the only thing refusing a frame. A SAMEORIGIN default here would
        // leave a dev/self-host instance framable from its own origin.
        const res = await request(appFor('development')).get('/');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['content-security-policy']).toBeUndefined();
    });

    it('never disagrees with itself: SAMEORIGIN is gone from both', async () => {
        const res = await request(appFor('production')).get('/');
        expect(res.headers['x-frame-options']).not.toMatch(/SAMEORIGIN/i);
        expect(res.headers['content-security-policy']).not.toMatch(/frame-ancestors 'self'/);
    });
});

describe('the rest of the production header set', () => {
    it('asks for HSTS for two years including subdomains, and never preload', async () => {
        const res = await request(appFor('production')).get('/');
        expect(res.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
        expect(res.headers['strict-transport-security']).not.toContain('preload');
    });

    it('sends no HSTS outside production, where TLS is not guaranteed', async () => {
        const res = await request(appFor('development')).get('/');
        expect(res.headers['strict-transport-security']).toBeUndefined();
    });

    it('denies the browser features this app never uses', async () => {
        const res = await request(appFor('production')).get('/');
        expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=(), interest-cohort=()');
    });

    it('keeps the deployment origin in connect-src so the SPA can reach its own API', async () => {
        const res = await request(appFor('production')).get('/');
        expect(res.headers['content-security-policy']).toContain("connect-src 'self' https://repomanager.example.pt");
    });
});

describe('API answers are never cacheable', () => {
    it('sends no-store on an API response', async () => {
        const res = await request(appFor('production')).get('/api/me');
        expect(res.headers['cache-control']).toBe('no-store');
    });

    it('leaves non-API responses to their own caching rules', async () => {
        // The shell and the hashed assets set their own directives in
        // server/index.js; a blanket no-store would throw that away.
        const res = await request(appFor('production')).get('/');
        expect(res.headers['cache-control']).toBeUndefined();
    });

    it('lets a streaming handler keep its own directive', async () => {
        const res = await request(appFor('production')).get('/api/stream');
        expect(res.headers['cache-control']).toBe('no-cache');
    });
});
