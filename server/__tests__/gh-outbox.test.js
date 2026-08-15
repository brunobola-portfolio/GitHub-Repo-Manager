// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { initDB } = await vi.importActual('../db.js')
const { makeIntegrationDb } = await import('./helpers/integration-db.js')
const testDb = makeIntegrationDb(initDB)

vi.mock('../db.js', () => ({ default: testDb }))

// Mock githubApi so we can deterministically simulate success / 5xx / 4xx.
const githubApiMock = vi.fn()
vi.mock('../lib/github-api.js', () => ({
    githubApi: (...args) => githubApiMock(...args),
}))

const { enqueueAndExecute, runOutboxOnce, listPendingForUser, makeIdempotencyKey, purgeOldSucceeded } =
    await import('../lib/gh-outbox.js')

const USER_ID = 1

beforeEach(() => {
    testDb.prepare('DELETE FROM gh_outbox').run()
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'tester')
    githubApiMock.mockReset()
})

describe('gh-outbox.enqueueAndExecute', () => {
    it('marks the row succeeded on a successful live call', async () => {
        githubApiMock.mockResolvedValue({ data: { merged: true }, headers: new Map() })

        const result = await enqueueAndExecute({
            userId: USER_ID,
            method: 'PUT',
            url: '/repos/o/r/pulls/42/merge',
            body: { merge_method: 'squash' },
            idempotencyKey: 'merge:42',
            token: 'tok',
        })

        expect(result.delivered).toBe(true)
        expect(result.queued).toBe(false)
        expect(result.data).toEqual({ merged: true })

        const row = testDb.prepare('SELECT * FROM gh_outbox WHERE idempotency_key=?').get(`${USER_ID}:merge:42`)
        expect(row.status).toBe('succeeded')
        expect(JSON.parse(row.response_body)).toEqual({ merged: true })
    })

    it('queues for retry on a 5xx and reports queued=true', async () => {
        const err = new Error('GitHub down')
        err.status = 503
        githubApiMock.mockRejectedValue(err)

        const result = await enqueueAndExecute({
            userId: USER_ID,
            method: 'PUT',
            url: '/repos/o/r/pulls/42/merge',
            body: null,
            idempotencyKey: 'merge:42',
            token: 'tok',
        })

        expect(result.delivered).toBe(false)
        expect(result.queued).toBe(true)
        expect(result.outboxId).toBeGreaterThan(0)

        const row = testDb.prepare('SELECT * FROM gh_outbox WHERE idempotency_key=?').get(`${USER_ID}:merge:42`)
        expect(row.status).toBe('pending')
        expect(row.attempts).toBe(1)
        expect(row.last_error).toContain('GitHub down')
        expect(row.next_retry_at).not.toBeNull()
    })

    it('marks the row failed and re-throws on a 4xx (not retryable)', async () => {
        const err = new Error('Bad request')
        err.status = 422
        githubApiMock.mockRejectedValue(err)

        await expect(enqueueAndExecute({
            userId: USER_ID,
            method: 'POST',
            url: '/repos/o/r/issues/1/comments',
            body: { body: 'hi' },
            idempotencyKey: 'comment:1',
            token: 'tok',
        })).rejects.toThrow('Bad request')

        const row = testDb.prepare('SELECT * FROM gh_outbox WHERE idempotency_key=?').get(`${USER_ID}:comment:1`)
        expect(row.status).toBe('failed')
        expect(row.next_retry_at).toBeNull()
    })

    it('idempotency_key dedups: a second successful call returns the cached response without re-firing', async () => {
        githubApiMock.mockResolvedValueOnce({ data: { ok: true }, headers: new Map() })

        const first = await enqueueAndExecute({
            userId: USER_ID, method: 'POST', url: '/x', body: null,
            idempotencyKey: 'shared', token: 'tok',
        })
        expect(first.data).toEqual({ ok: true })
        expect(githubApiMock).toHaveBeenCalledTimes(1)

        // Second call with the same idempotency key should NOT re-invoke githubApi.
        const second = await enqueueAndExecute({
            userId: USER_ID, method: 'POST', url: '/x', body: null,
            idempotencyKey: 'shared', token: 'tok',
        })
        expect(second.data).toEqual({ ok: true })
        expect(second.delivered).toBe(true)
        expect(githubApiMock).toHaveBeenCalledTimes(1)
    })

    it('namespaces the idempotency key by user so one user cannot read back another\'s response', async () => {
        testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(2, 'other')

        githubApiMock.mockResolvedValueOnce({ data: { secret: 'user-1-data' }, headers: new Map() })
        const a = await enqueueAndExecute({
            userId: USER_ID, method: 'POST', url: '/x', body: { v: 1 },
            idempotencyKey: 'collide', token: 'tok-a',
        })
        expect(a.data).toEqual({ secret: 'user-1-data' })

        githubApiMock.mockResolvedValueOnce({ data: { secret: 'user-2-data' }, headers: new Map() })
        const b = await enqueueAndExecute({
            userId: 2, method: 'POST', url: '/x', body: { v: 1 },
            idempotencyKey: 'collide', token: 'tok-b',
        })
        // User 2 must get THEIR own fresh call, not user 1's cached response.
        expect(b.data).toEqual({ secret: 'user-2-data' })
        expect(githubApiMock).toHaveBeenCalledTimes(2)

        const keys = testDb.prepare('SELECT idempotency_key FROM gh_outbox ORDER BY user_id').all().map(r => r.idempotency_key)
        expect(keys).toEqual([`${USER_ID}:collide`, '2:collide'])
    })

    it('429 (rate limit) is treated as retryable, not failed', async () => {
        const err = new Error('rate limited')
        err.status = 429
        githubApiMock.mockRejectedValue(err)

        const result = await enqueueAndExecute({
            userId: USER_ID, method: 'POST', url: '/y', body: null,
            idempotencyKey: 'rl:1', token: 'tok',
        })

        expect(result.queued).toBe(true)
        const row = testDb.prepare('SELECT status FROM gh_outbox WHERE idempotency_key=?').get(`${USER_ID}:rl:1`)
        expect(row.status).toBe('pending')
    })
})

describe('gh-outbox.runOutboxOnce', () => {
    it('retries pending rows whose next_retry_at has passed and marks them succeeded', async () => {
        // Seed a pending row with next_retry_at in the past
        testDb.prepare(`
            INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key, status, attempts, next_retry_at)
            VALUES (?, 'PUT', '/r/m', NULL, 'k1', 'pending', 1, datetime('now', '-1 minute'))
        `).run(USER_ID)

        githubApiMock.mockResolvedValue({ data: { ok: true }, headers: new Map() })

        const summary = await runOutboxOnce({
            tokenLookup: async () => 'tok',
        })

        expect(summary.picked).toBe(1)
        expect(summary.succeeded).toBe(1)
        expect(githubApiMock).toHaveBeenCalledOnce()

        const row = testDb.prepare('SELECT status FROM gh_outbox WHERE idempotency_key=?').get('k1')
        expect(row.status).toBe('succeeded')
    })

    it('reschedules with backoff on retryable failure', async () => {
        testDb.prepare(`
            INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key, status, attempts, next_retry_at)
            VALUES (?, 'PUT', '/r/m', NULL, 'k2', 'pending', 1, datetime('now', '-1 minute'))
        `).run(USER_ID)

        const err = new Error('still down')
        err.status = 503
        githubApiMock.mockRejectedValue(err)

        const summary = await runOutboxOnce({ tokenLookup: async () => 'tok' })

        expect(summary.stillPending).toBe(1)
        const row = testDb.prepare('SELECT * FROM gh_outbox WHERE idempotency_key=?').get('k2')
        expect(row.status).toBe('pending')
        expect(row.attempts).toBe(2)
        expect(row.next_retry_at).not.toBeNull()
    })

    it('gives up on non-retryable error', async () => {
        testDb.prepare(`
            INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key, status, attempts, next_retry_at)
            VALUES (?, 'PATCH', '/r/m', NULL, 'k3', 'pending', 1, datetime('now', '-1 minute'))
        `).run(USER_ID)

        const err = new Error('forbidden')
        err.status = 403
        githubApiMock.mockRejectedValue(err)

        const summary = await runOutboxOnce({ tokenLookup: async () => 'tok' })
        expect(summary.givenUp).toBe(1)
        const row = testDb.prepare('SELECT status FROM gh_outbox WHERE idempotency_key=?').get('k3')
        expect(row.status).toBe('failed')
    })

    it('skips rows when no token available and reschedules them', async () => {
        testDb.prepare(`
            INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key, status, attempts, next_retry_at)
            VALUES (?, 'PUT', '/r/m', NULL, 'k4', 'pending', 1, datetime('now', '-1 minute'))
        `).run(USER_ID)

        const summary = await runOutboxOnce({ tokenLookup: async () => null })
        expect(summary.stillPending).toBe(1)
        expect(githubApiMock).not.toHaveBeenCalled()
    })
})

describe('gh-outbox helpers', () => {
    it('listPendingForUser returns only pending rows for the user', () => {
        testDb.prepare(`
            INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key, status, next_retry_at)
            VALUES (?, 'PUT', '/a', NULL, 'a', 'pending', datetime('now'))
        `).run(USER_ID)
        testDb.prepare(`
            INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key, status, next_retry_at)
            VALUES (?, 'PUT', '/b', NULL, 'b', 'succeeded', NULL)
        `).run(USER_ID)
        // Different user
        testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(2, 'other')
        testDb.prepare(`
            INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key, status, next_retry_at)
            VALUES (?, 'PUT', '/c', NULL, 'c', 'pending', datetime('now'))
        `).run(2)

        const rows = listPendingForUser(USER_ID)
        expect(rows.length).toBe(1)
        expect(rows[0].url).toBe('/a')
    })

    it('makeIdempotencyKey is deterministic when bodyHash is supplied', () => {
        const a = makeIdempotencyKey('PUT', '/x', 'h1')
        const b = makeIdempotencyKey('PUT', '/x', 'h1')
        expect(a).toBe(b)
    })

    it('makeIdempotencyKey is unique-per-call without bodyHash', () => {
        const a = makeIdempotencyKey('POST', '/x')
        const b = makeIdempotencyKey('POST', '/x')
        expect(a).not.toBe(b)
    })

    it('makeIdempotencyKey treats an empty-string bodyHash as a real (deterministic) hash, not absent', () => {
        // Regression: `bodyHash ?` mis-classified '' (falsy) as "no key" and went
        // random, so a bodyless mutation + retry could double-execute.
        const a = makeIdempotencyKey('PUT', '/x', '')
        const b = makeIdempotencyKey('PUT', '/x', '')
        expect(a).toBe(b)
    })

    it('purgeOldSucceeded drops succeeded rows older than 1 day', () => {
        testDb.prepare(`
            INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key, status, completed_at)
            VALUES (?, 'PUT', '/old', NULL, 'old', 'succeeded', datetime('now', '-2 days'))
        `).run(USER_ID)
        testDb.prepare(`
            INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key, status, completed_at)
            VALUES (?, 'PUT', '/new', NULL, 'new', 'succeeded', datetime('now', '-1 hour'))
        `).run(USER_ID)
        testDb.prepare(`
            INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key, status, next_retry_at)
            VALUES (?, 'PUT', '/pending', NULL, 'p', 'pending', datetime('now'))
        `).run(USER_ID)

        const dropped = purgeOldSucceeded()
        expect(dropped).toBe(1)
        const remaining = testDb.prepare('SELECT idempotency_key FROM gh_outbox ORDER BY id').all().map(r => r.idempotency_key)
        expect(remaining).toEqual(['new', 'p'])
    })
})
