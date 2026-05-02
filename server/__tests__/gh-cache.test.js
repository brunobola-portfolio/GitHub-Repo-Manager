// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock db with an in-memory SQLite handle that has the real schema applied.
const { initDB } = await vi.importActual('../db.js')
const { makeIntegrationDb } = await import('./helpers/integration-db.js')
const testDb = makeIntegrationDb(initDB)

vi.mock('../db.js', () => ({ default: testDb }))

const { readThrough, invalidate, invalidateByRepo, purgeOlderThan } = await import('../lib/gh-cache.js')

const USER_ID = 1

beforeEach(() => {
    testDb.prepare('DELETE FROM gh_cache').run()
    // Insert the user row so the FK on gh_cache.user_id is satisfied.
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'tester')
})

describe('gh-cache.readThrough', () => {
    it('serves fresh cache without calling the fetcher when within TTL', async () => {
        // Seed a fresh row
        testDb.prepare(`
            INSERT INTO gh_cache (user_id, resource_type, resource_key, payload, etag, fetched_at, stale_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now', '+1 hour'))
        `).run(USER_ID, 'pulls', 'acme/site', JSON.stringify([{ id: 42 }]), 'W/"abc"')

        const fetcher = vi.fn()
        const result = await readThrough({
            userId: USER_ID, resourceType: 'pulls', resourceKey: 'acme/site',
            ttlMs: 60_000, fetcher,
        })

        expect(fetcher).not.toHaveBeenCalled()
        expect(result.data).toEqual([{ id: 42 }])
        expect(result.fromCache).toBe(true)
        expect(result.stale).toBe(false)
    })

    it('cold cache + successful fetch persists the row and returns fresh data', async () => {
        const headers = new Map([['etag', 'W/"x"']])
        headers.get = function (k) { return Map.prototype.get.call(this, k.toLowerCase()) }
        const fetcher = vi.fn(async () => ({ data: [{ id: 7 }], headers }))

        const result = await readThrough({
            userId: USER_ID, resourceType: 'pulls', resourceKey: 'acme/site',
            ttlMs: 60_000, fetcher,
        })

        expect(fetcher).toHaveBeenCalledOnce()
        expect(result.data).toEqual([{ id: 7 }])
        expect(result.fromCache).toBe(false)
        expect(result.stale).toBe(false)

        const row = testDb.prepare(`
            SELECT payload, etag FROM gh_cache
            WHERE user_id=? AND resource_type=? AND resource_key=?
        `).get(USER_ID, 'pulls', 'acme/site')
        expect(JSON.parse(row.payload)).toEqual([{ id: 7 }])
        expect(row.etag).toBe('W/"x"')
    })

    it('serves stale cache when the fetcher throws a 5xx', async () => {
        testDb.prepare(`
            INSERT INTO gh_cache (user_id, resource_type, resource_key, payload, etag, fetched_at, stale_at)
            VALUES (?, ?, ?, ?, NULL, datetime('now'), datetime('now', '-1 minute'))
        `).run(USER_ID, 'pulls', 'acme/site', JSON.stringify([{ id: 1 }]))

        const fetcher = vi.fn(async () => {
            const err = new Error('GitHub down')
            err.status = 503
            throw err
        })

        const result = await readThrough({
            userId: USER_ID, resourceType: 'pulls', resourceKey: 'acme/site',
            ttlMs: 60_000, fetcher,
        })

        expect(fetcher).toHaveBeenCalledOnce()
        expect(result.fromCache).toBe(true)
        expect(result.stale).toBe(true)
        expect(result.data).toEqual([{ id: 1 }])
    })

    it('cold cache + 5xx fetch propagates the error', async () => {
        const fetcher = vi.fn(async () => {
            const err = new Error('boom')
            err.status = 503
            throw err
        })

        await expect(readThrough({
            userId: USER_ID, resourceType: 'pulls', resourceKey: 'cold',
            ttlMs: 60_000, fetcher,
        })).rejects.toThrow('boom')
    })

    it('4xx (other than 429) propagates even when cache exists', async () => {
        testDb.prepare(`
            INSERT INTO gh_cache (user_id, resource_type, resource_key, payload, etag, fetched_at, stale_at)
            VALUES (?, ?, ?, ?, NULL, datetime('now'), datetime('now', '-1 minute'))
        `).run(USER_ID, 'pulls', 'forbidden', JSON.stringify({ stale: true }))

        const fetcher = vi.fn(async () => {
            const err = new Error('forbidden')
            err.status = 403
            throw err
        })

        await expect(readThrough({
            userId: USER_ID, resourceType: 'pulls', resourceKey: 'forbidden',
            ttlMs: 60_000, fetcher,
        })).rejects.toThrow('forbidden')
    })

    it('429 falls back to stale cache (treated as transient)', async () => {
        testDb.prepare(`
            INSERT INTO gh_cache (user_id, resource_type, resource_key, payload, etag, fetched_at, stale_at)
            VALUES (?, ?, ?, ?, NULL, datetime('now'), datetime('now', '-1 minute'))
        `).run(USER_ID, 'pulls', 'rate', JSON.stringify({ stale: true }))

        const fetcher = vi.fn(async () => {
            const err = new Error('rate limited')
            err.status = 429
            throw err
        })

        const result = await readThrough({
            userId: USER_ID, resourceType: 'pulls', resourceKey: 'rate',
            ttlMs: 60_000, fetcher,
        })

        expect(result.stale).toBe(true)
        expect(result.data).toEqual({ stale: true })
    })

    it('304 Not Modified slides the staleness window without replacing payload', async () => {
        testDb.prepare(`
            INSERT INTO gh_cache (user_id, resource_type, resource_key, payload, etag, fetched_at, stale_at)
            VALUES (?, ?, ?, ?, ?, datetime('now', '-2 hours'), datetime('now', '-1 hour'))
        `).run(USER_ID, 'pulls', 'site', JSON.stringify([{ id: 99 }]), 'W/"orig"')

        const fetcher = vi.fn(async () => ({ data: null, status: 304, headers: new Map() }))

        const result = await readThrough({
            userId: USER_ID, resourceType: 'pulls', resourceKey: 'site',
            ttlMs: 60_000, fetcher,
        })

        expect(result.data).toEqual([{ id: 99 }])
        expect(result.fromCache).toBe(true)
        expect(result.stale).toBe(false)
    })
})

describe('gh-cache.invalidate', () => {
    beforeEach(() => {
        const seed = testDb.prepare(`
            INSERT INTO gh_cache (user_id, resource_type, resource_key, payload, fetched_at, stale_at)
            VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+1 hour'))
        `)
        seed.run(USER_ID, 'pulls', 'acme/site#1', '{}')
        seed.run(USER_ID, 'pulls', 'acme/site#2', '{}')
        seed.run(USER_ID, 'issues', 'acme/site#3', '{}')
        seed.run(USER_ID, 'pulls', 'other/repo#1', '{}')
    })

    it('drops only the rows matching prefix + resource_type', () => {
        const dropped = invalidate({ userId: USER_ID, resourceType: 'pulls', prefix: 'acme/site' })
        expect(dropped).toBe(2)
        const remaining = testDb.prepare('SELECT COUNT(*) AS c FROM gh_cache').get().c
        expect(remaining).toBe(2) // 1 issue, 1 other-repo
    })

    it('without prefix drops all of resource_type', () => {
        const dropped = invalidate({ userId: USER_ID, resourceType: 'pulls' })
        expect(dropped).toBe(3)
    })

    it('without resource_type drops everything for the user', () => {
        const dropped = invalidate({ userId: USER_ID })
        expect(dropped).toBe(4)
    })
})

describe('gh-cache.invalidateByRepo', () => {
    beforeEach(() => {
        const seed = testDb.prepare(`
            INSERT INTO gh_cache (user_id, resource_type, resource_key, payload, fetched_at, stale_at)
            VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+1 hour'))
        `)
        seed.run(USER_ID, 'pulls', 'acme/site#1', '{}')
        seed.run(USER_ID, 'pull_comments', 'acme/site#1', '{}')
        seed.run(USER_ID, 'pulls', 'other/repo#1', '{}')
    })

    it('drops all rows whose key includes the repo name', () => {
        const dropped = invalidateByRepo('acme/site')
        expect(dropped).toBe(2)
        const remaining = testDb.prepare('SELECT resource_key FROM gh_cache').all()
        expect(remaining.length).toBe(1)
        expect(remaining[0].resource_key).toBe('other/repo#1')
    })
})

describe('gh-cache.purgeOlderThan', () => {
    it('drops rows older than maxAgeDays based on fetched_at', () => {
        testDb.prepare(`
            INSERT INTO gh_cache (user_id, resource_type, resource_key, payload, fetched_at, stale_at)
            VALUES (?, ?, ?, ?, datetime('now', '-40 days'), datetime('now', '+1 hour'))
        `).run(USER_ID, 'pulls', 'old', '{}')
        testDb.prepare(`
            INSERT INTO gh_cache (user_id, resource_type, resource_key, payload, fetched_at, stale_at)
            VALUES (?, ?, ?, ?, datetime('now', '-1 day'), datetime('now', '+1 hour'))
        `).run(USER_ID, 'pulls', 'fresh', '{}')

        const purged = purgeOlderThan(30)
        expect(purged).toBe(1)
        const remaining = testDb.prepare('SELECT resource_key FROM gh_cache').all()
        expect(remaining.length).toBe(1)
        expect(remaining[0].resource_key).toBe('fresh')
    })
})
