// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

import {
    validateBody,
    validateQuery,
    validateParams,
} from '../middleware/validate-request.js';

function makeApp(configure) {
    const app = express();
    app.use(express.json());
    configure(app);
    return app;
}

describe('validateBody', () => {
    const schema = z.object({
        name: z.string().min(1).max(50),
        count: z.number().int().positive(),
    });

    it('passes through when body is valid and attaches req.validatedBody', async () => {
        const app = makeApp((a) => {
            a.post('/t', validateBody(schema), (req, res) => {
                res.json({ validated: req.validatedBody, rawBody: req.body });
            });
        });
        const res = await request(app).post('/t').send({ name: 'alice', count: 3 });
        expect(res.status).toBe(200);
        expect(res.body.validated).toEqual({ name: 'alice', count: 3 });
        // validateBody should NOT mutate req.body in place — the raw body is preserved.
        expect(res.body.rawBody).toEqual({ name: 'alice', count: 3 });
    });

    it('returns 400 { error, code: "VALIDATION_ERROR" } for invalid body', async () => {
        const app = makeApp((a) => {
            a.post('/t', validateBody(schema), (_req, res) => res.json({ ok: true }));
        });
        const res = await request(app).post('/t').send({ name: '', count: 3 });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(typeof res.body.error).toBe('string');
        expect(res.body.error).toMatch(/^name: /);
    });

    it('does not call the handler when validation fails', async () => {
        let handlerCalled = false;
        const app = makeApp((a) => {
            a.post('/t', validateBody(schema), (_req, res) => {
                handlerCalled = true;
                res.json({ ok: true });
            });
        });
        await request(app).post('/t').send({});
        expect(handlerCalled).toBe(false);
    });

    it('formats nested paths into dotted prefix on the message (first issue only)', async () => {
        const nestedSchema = z.object({
            user: z.object({
                profile: z.object({
                    age: z.number().int().positive(),
                }),
            }),
        });
        const app = makeApp((a) => {
            a.post('/t', validateBody(nestedSchema), (_req, res) => res.json({ ok: true }));
        });
        const res = await request(app).post('/t').send({ user: { profile: { age: -1 } } });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.startsWith('user.profile.age: ')).toBe(true);
    });

    it('reports only the first issue when multiple fail', async () => {
        const multi = z.object({
            a: z.string().min(1),
            b: z.number().int().positive(),
            c: z.string().email(),
        });
        const app = makeApp((a) => {
            a.post('/t', validateBody(multi), (_req, res) => res.json({ ok: true }));
        });
        const res = await request(app).post('/t').send({ a: '', b: -1, c: 'not-an-email' });
        expect(res.status).toBe(400);
        // Only one "field: msg" fragment — the message is a single string, not a list of all issues.
        expect(res.body.error.split(': ').length).toBeLessThanOrEqual(3); // "a: <msg>" at most
        expect(res.body.error.startsWith('a: ')).toBe(true);
    });

    it('omits path prefix when the issue has no path (top-level shape error)', async () => {
        const topLevel = z.string();
        const app = makeApp((a) => {
            // express.json() gives us an object by default; send a raw non-object instead
            a.post('/t', validateBody(topLevel), (_req, res) => res.json({ ok: true }));
        });
        const res = await request(app)
            .post('/t')
            .set('Content-Type', 'application/json')
            .send('{"not":"a string"}');
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        // No leading "path:" segment when issue.path is empty
        expect(res.body.error).not.toMatch(/^\s*:\s/);
    });
});

describe('validateQuery', () => {
    const schema = z.object({
        limit: z.coerce.number().int().positive().max(100),
    });

    it('passes through valid query and attaches req.validatedQuery', async () => {
        const app = makeApp((a) => {
            a.get('/t', validateQuery(schema), (req, res) => res.json({ validated: req.validatedQuery }));
        });
        const res = await request(app).get('/t?limit=25');
        expect(res.status).toBe(200);
        expect(res.body.validated).toEqual({ limit: 25 });
    });

    it('returns 400 validation_failed for invalid query', async () => {
        const app = makeApp((a) => {
            a.get('/t', validateQuery(schema), (_req, res) => res.json({ ok: true }));
        });
        const res = await request(app).get('/t?limit=9999');
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.error).toMatch(/^limit: /);
    });
});

describe('validateParams', () => {
    const schema = z.object({
        id: z.coerce.number().int().positive(),
    });

    it('passes through valid params and attaches req.validatedParams', async () => {
        const app = makeApp((a) => {
            a.get('/thing/:id', validateParams(schema), (req, res) => res.json({ validated: req.validatedParams }));
        });
        const res = await request(app).get('/thing/7');
        expect(res.status).toBe(200);
        expect(res.body.validated).toEqual({ id: 7 });
    });

    it('returns 400 validation_failed for invalid params', async () => {
        const app = makeApp((a) => {
            a.get('/thing/:id', validateParams(schema), (_req, res) => res.json({ ok: true }));
        });
        const res = await request(app).get('/thing/not-a-number');
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.error).toMatch(/^id: /);
    });
});
