/*
 * Numbers and capability claims in the docs and the diagrams rot silently.
 *
 * The architecture diagram advertised "~324 handlers · 74 route modules" and
 * "no Redis"; the API reference said 331 handlers across 74 files. The counts
 * had drifted, and "no Redis" was simply false — REDIS_URL switches sessions,
 * rate limiting and the job queue onto Redis. A reader cannot tell a stale
 * diagram from a current one, which is what makes this worth gating.
 *
 * Counted the same way API.md documents its own method, so the doc and the
 * gate cannot disagree about what is being counted.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

function routeFiles() {
    return readdirSync('server/routes', { recursive: true })
        .filter((f) => typeof f === 'string' && f.endsWith('.js'))
        .map((f) => join('server/routes', f).split(sep).join('/'))
}

const HANDLER_RE = /^\s*router\.(get|post|put|patch|delete)\(/
const APP_HANDLER_RE = /^\s*app\.(get|post|put|patch|delete)\(/

const routeHandlerCount = routeFiles()
    .flatMap((f) => readFileSync(f, 'utf8').split('\n'))
    .filter((l) => HANDLER_RE.test(l)).length
const routeFileCount = routeFiles().length
const appHandlerCount = readFileSync('server/index.js', 'utf8')
    .split('\n').filter((l) => APP_HANDLER_RE.test(l)).length

const architectureSvg = readFileSync('docs/images/architecture.svg', 'utf8')
const apiDoc = readFileSync('docs/api/API.md', 'utf8')
const docsIndex = readFileSync('docs/index.md', 'utf8')

describe('the API reference counts what actually ships', () => {
    it('finds handlers at all (guards the counter itself)', () => {
        expect(routeHandlerCount).toBeGreaterThan(100)
        expect(routeFileCount).toBeGreaterThan(20)
        expect(appHandlerCount).toBeGreaterThan(0)
    })

    it('states the real total', () => {
        const total = routeHandlerCount + appHandlerCount
        expect(apiDoc, `API.md should say ${total} total handlers`).toContain(`${total} route handlers`)
        expect(apiDoc, `API.md should say ${routeHandlerCount} across server/routes`).toContain(`${routeHandlerCount} across`)
    })

    it('states the real route-file count', () => {
        expect(apiDoc).toContain(`${routeFileCount} route files`)
    })

    it('the docs map agrees with the API reference', () => {
        const total = routeHandlerCount + appHandlerCount
        const claims = [...docsIndex.matchAll(/(\d+) route handlers/g)].map((m) => Number(m[1]))
        expect(claims.length, 'docs/index.md no longer states a handler count').toBeGreaterThan(0)
        expect([...new Set(claims)], 'docs/index.md disagrees with the real count').toEqual([total])
    })
})

describe('the architecture diagram tells the truth', () => {
    it('states the real handler and module counts', () => {
        expect(architectureSvg).toContain(`${routeHandlerCount} handlers`)
        expect(architectureSvg).toContain(`${routeFileCount} route modules`)
    })

    it('does not claim Redis is absent, because REDIS_URL enables it', () => {
        const redisSupported = /REDIS_URL/.test(readFileSync('server/config.js', 'utf8'))
        expect(redisSupported, 'REDIS_URL vanished — re-point this gate').toBe(true)
        expect(architectureSvg, 'the diagram denies an optional backing service that exists').not.toMatch(/no Redis/i)
    })

    it('still says PostgreSQL is unsupported, which is true and deliberate', () => {
        expect(architectureSvg).toMatch(/no PostgreSQL/i)
    })
})

describe('the action-dispatch diagram counts the real allow-list', () => {
    // The whole point of that diagram is that a fixed allow-list is the gate.
    // If the list grows and the picture still says 7, the picture is arguing
    // for a guarantee it no longer describes.
    const aiActions = readFileSync('src/utils/aiActions.js', 'utf8')
    const dispatchSvg = readFileSync('docs/images/action-dispatch.svg', 'utf8')

    const declared = aiActions.slice(
        aiActions.indexOf('const AI_ACTIONS'),
        aiActions.indexOf('export const AI_ACTION_TYPES'),
    )
    const actionCount = (declared.match(/^ {2}[a-z_]+:/gm) || []).length

    it('finds the allow-list at all (guards the counter itself)', () => {
        expect(actionCount).toBeGreaterThan(3)
    })

    it('states the real number of allow-listed action types', () => {
        expect(dispatchSvg, `the diagram should say ${actionCount}`).toContain(`AI_ACTION_TYPES (${actionCount})`)
    })
})
