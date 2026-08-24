// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/*
 * Per-tenant webhook ingest tokens.
 *
 * The instance-wide WEBHOOK_SECRET is one key for the whole box. The setup
 * hint told every user to configure THAT key on their repositories, so on a
 * shared deployment any tenant could sign events for all the others. These
 * tests pin the three properties that close it:
 *   1. a token URL verifies with the TOKEN's secret, not the instance's;
 *   2. events on a token URL are attributed to the token's owner;
 *   3. a saas deployment refuses the shared endpoint outright.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

const rows = new Map(); // tokenId -> { user_id, secret }
const tracked = [];
const dbMock = {
    prepare: vi.fn((sql) => ({
        get: (arg) => {
            if (sql.includes('FROM webhook_ingest_tokens')) return rows.get(arg);
            return undefined;
        },
        run: () => ({ changes: 1 }),
        all: () => [],
    })),
};
vi.mock('../db.js', () => ({ default: dbMock }));
vi.mock('../lib/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../lib/work-board-tracking.js', () => ({
    upsertTrackedRepoFromWebhook: (userId, repo) => tracked.push({ userId, repo }),
}));

const { githubEventsWebhookHandler } = await import('../routes/github-events-webhook.js');

const PAYLOAD = Buffer.from(JSON.stringify({
    action: 'opened',
    repository: { full_name: 'tenant-a/private-repo', id: 7, owner: { login: 'tenant-a' } },
}));

function sign(secret) {
    return 'sha256=' + createHmac('sha256', secret).update(PAYLOAD).digest('hex');
}

function reqFor({ tokenId, signature, event = 'push' } = {}) {
    return {
        params: tokenId ? { tokenId } : {},
        headers: {
            'x-hub-signature-256': signature,
            'x-github-event': event,
            'x-github-delivery': 'd-1',
        },
        body: PAYLOAD,
    };
}

function resSpy() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

const flush = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
    rows.clear();
    tracked.length = 0;
    process.env.WEBHOOK_SECRET = 'instance-secret-0123456789abcdef0123456789abcdef';
    delete process.env.DEPLOYMENT_MODE;
});
afterEach(() => {
    delete process.env.WEBHOOK_SECRET;
    delete process.env.DEPLOYMENT_MODE;
});

describe('the token URL verifies with the token secret', () => {
    it('accepts a delivery signed with the tenant secret and attributes it to the owner', async () => {
        rows.set('tok1', { user_id: 42, secret: 'tenant-secret' });
        const res = resSpy();
        await githubEventsWebhookHandler(reqFor({ tokenId: 'tok1', signature: sign('tenant-secret') }), res);
        await flush();
        expect(res.statusCode).toBe(200);
        expect(tracked).toEqual([{ userId: 42, repo: 'tenant-a/private-repo' }]);
    });

    it('rejects the INSTANCE secret on a token URL — the two keys never interchange', async () => {
        rows.set('tok1', { user_id: 42, secret: 'tenant-secret' });
        const res = resSpy();
        await githubEventsWebhookHandler(
            reqFor({ tokenId: 'tok1', signature: sign(process.env.WEBHOOK_SECRET) }), res);
        expect(res.statusCode).toBe(401);
        expect(tracked).toEqual([]);
    });

    it('answers an unknown token exactly like a bad signature', async () => {
        const res = resSpy();
        await githubEventsWebhookHandler(reqFor({ tokenId: 'nope', signature: sign('anything') }), res);
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Invalid webhook signature' });
    });

    it("another tenant's secret cannot sign for this token", async () => {
        rows.set('tok1', { user_id: 42, secret: 'tenant-a-secret' });
        rows.set('tok2', { user_id: 99, secret: 'tenant-b-secret' });
        const res = resSpy();
        await githubEventsWebhookHandler(reqFor({ tokenId: 'tok1', signature: sign('tenant-b-secret') }), res);
        expect(res.statusCode).toBe(401);
    });
});

describe('the shared endpoint and DEPLOYMENT_MODE', () => {
    it('still works on self-host (the default)', async () => {
        const res = resSpy();
        await githubEventsWebhookHandler(reqFor({ signature: sign(process.env.WEBHOOK_SECRET) }), res);
        await flush();
        expect(res.statusCode).toBe(200);
    });

    it('refuses outright on saas, before any signature check', async () => {
        process.env.DEPLOYMENT_MODE = 'saas';
        const res = resSpy();
        await githubEventsWebhookHandler(reqFor({ signature: sign(process.env.WEBHOOK_SECRET) }), res);
        expect(res.statusCode).toBe(410);
        expect(res.body.error).toMatch(/personal webhook URL/);
    });

    it('token URLs keep working on saas — that is the whole point', async () => {
        process.env.DEPLOYMENT_MODE = 'saas';
        rows.set('tok1', { user_id: 42, secret: 'tenant-secret' });
        const res = resSpy();
        await githubEventsWebhookHandler(reqFor({ tokenId: 'tok1', signature: sign('tenant-secret') }), res);
        await flush();
        expect(res.statusCode).toBe(200);
        expect(tracked).toEqual([{ userId: 42, repo: 'tenant-a/private-repo' }]);
    });
});

describe('the management API', () => {
    it('never returns the secret on GET, and requires a session on both verbs', async () => {
        const src = (await import('node:fs')).readFileSync('server/routes/webhook-ingest-token.js', 'utf8');
        // GET selects only non-secret columns.
        expect(src).toMatch(/SELECT id, created_at, last_used_at FROM webhook_ingest_tokens/);
        expect(src).not.toMatch(/SELECT \*.*FROM webhook_ingest_tokens/);
        // Both routes carry requireAuth.
        expect([...src.matchAll(/router\.(get|post)\('\/ingest-token', requireAuth,/g)]).toHaveLength(2);
        // Rotation: INSERT OR REPLACE on the UNIQUE user_id kills the old pair.
        expect(src).toMatch(/INSERT OR REPLACE INTO webhook_ingest_tokens/);
    });
});
