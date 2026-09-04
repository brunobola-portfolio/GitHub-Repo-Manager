/*
 * Raw `fetch(` calls bypass src/utils/api.js#fetchWithRetry — and with it the
 * CSRF rotation-retry, the offline mutation queue, the session-expiry signal,
 * the 30 s timeout and the typed ApiError. The 2026-09-04 panel counted 166;
 * the migration is incremental, so this gate only refuses to let the number
 * grow. Lower the ceiling as call sites move over.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CEILING = 128

/** The transport layer itself, and the two helpers that wrap fetch on purpose. */
const ALLOWED = new Set([
    'src/utils/api.js',
    'src/api/aiFetch.js',
    'src/utils/aiFetch.js',
    'src/api/sessionInfo.js',
])

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry).split('\\').join('/')
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.(jsx?)$/.test(p)) out.push(p)
    }
    return out
}

// A bare call — not `.fetch(`, `refetch(`, `prefetch(`, `fetchWithRetry(`.
const RAW_FETCH = /(?<![.\w])fetch\(/g

function countRawFetch() {
    const perFile = []
    let total = 0
    for (const file of walk('src')) {
        if (ALLOWED.has(file)) continue
        const n = (readFileSync(file, 'utf8').match(RAW_FETCH) || []).length
        if (n) { perFile.push(`${file}: ${n}`); total += n }
    }
    return { total, perFile }
}

describe('raw fetch() ratchet', () => {
    it('finds call sites at all (guards the scanner)', () => {
        expect(countRawFetch().total).toBeGreaterThan(10)
    })

    it(`never exceeds the ceiling of ${CEILING}`, () => {
        const { total, perFile } = countRawFetch()
        expect(
            total,
            `raw fetch() count rose to ${total} (ceiling ${CEILING}) — route new calls through apiCall/fetchWithRetry:\n${perFile.join('\n')}`,
        ).toBeLessThanOrEqual(CEILING)
    })
})
