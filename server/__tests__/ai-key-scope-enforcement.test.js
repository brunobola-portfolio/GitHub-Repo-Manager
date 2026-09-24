// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

// ---------------------------------------------------------------------------
// This suite exercises the REAL auth chain end-to-end
// (requireAuth -> apiKeyAuth -> requireScope('ai')) via supertest, unlike the
// other ai-*-route tests which mock `middleware/auth.js` wholesale. That's
// the point here: we're verifying the interaction between the generic
// write/admin gate in api-key-auth.js and the route-level requireScope('ai')
// guard on the AI generation routes — i.e. that an `ai`-scoped key can reach
// those routes, a `write`-only key can no longer reach them, an `ai`-only key
// still can't mutate anything else, and admin/session are unaffected.
// ---------------------------------------------------------------------------

const mockPrepare = vi.fn()
vi.mock('../db.js', () => ({ default: { prepare: mockPrepare } }))

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockGenerate = vi.fn()

// Keep the chat prompt hermetic — its own construction (persona overrides,
// error-KB grounding) is covered by ai-chat-prompt*.test.js; here we only
// care about the auth/scope boundary in front of the handler.
vi.mock('../lib/ai-chat-prompt.js', () => ({
    buildChatPrompt: () => 'test system prompt',
}))

vi.mock('../lib/usage-meter.js', () => ({
    // Added with reserveAIQuota: a FULL module mock silently drops new
    // exports, and route handlers then call undefined and 500.
    guardedIncrementAIUsage: vi.fn(() => ({ allowed: true, metric: 'ai', current: 0, limit: 100, remaining: 100 })),
    releaseGuardedAIUsage: vi.fn(),

    checkUsageLimit: () => ({ allowed: true, current: 0, limit: 100, remaining: 100 }),
    incrementUsage: vi.fn(),
    checkAIFeatureLimit: () => ({ allowed: true }),
    incrementAIUsage: vi.fn(),
    quotaExceededResponse: () => ({ error: 'quota' }),
}))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
vi.mock('../lib/ai-spend-cap.js', () => ({
    checkAISpendCap: () => ({ allowed: true }),
    recordAISpend: vi.fn(),
}))
vi.mock('../lib/ai-output-budget.js', () => ({ resolveMaxOutputTokens: () => 1000 }))
vi.mock('../lib/ai-audit.js', () => ({ buildAIAuditMeta: () => ({}) }))
vi.mock('../ai-service.js', () => ({
    aiService: { model: {} },
    sanitizeForPrompt: (s) => String(s || ''),
}))
vi.mock('../lib/utils.js', () => ({
    safeJsonParse: (v) => { try { return JSON.parse(v) } catch { return null } },
}))

// Real middleware/auth.js, real middleware/api-key-auth.js, real routes/ai.js
// — none of these are mocked, so the actual requireAuth -> apiKeyAuth ->
// requireScope('ai') chain runs.
const { default: aiRouter, AI_PREFIXED_ROUTERS } = await import('../routes/ai.js')
const { requireAuth } = await import('../middleware/auth.js')
const { AI_GENERATION_ROUTE_PATHS, AI_GENERATION_ROUTE_PATTERNS } = await import('../middleware/api-key-auth.js')

function makeApp() {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
        // Mimics attachAIProvider() closely enough for requireAI's real logic
        // to resolve a provider without needing the full BYOK/session stack.
        req.getAIProvider = async () => ({ generate: mockGenerate, model: 'mock-model' })
        next()
    })
    app.use('/api', aiRouter)
    // Stand-in non-AI mutating endpoint. Proves the `ai`-scope carve-out in
    // apiKeyAuth is narrowly scoped to AI routes, not a blanket bypass.
    app.post('/api/other-write', requireAuth, (req, res) => res.json({ ok: true }))
    return app
}

function seedApiKey(scopes) {
    const mockGet = vi.fn().mockReturnValue({
        id: 'key-1',
        user_id: 7,
        scopes: JSON.stringify(scopes),
        expires_at: null,
        revoked_at: null,
    })
    const mockRun = vi.fn()
    mockPrepare
        .mockReturnValueOnce({ get: mockGet }) // SELECT (api key lookup)
        .mockReturnValueOnce({ run: mockRun })  // UPDATE last_used_at (only if the gate passes)
    return { mockGet, mockRun }
}

beforeEach(() => {
    mockPrepare.mockReset()
    mockGenerate.mockReset().mockResolvedValue({
        text: JSON.stringify({ reply: 'hello from AI' }),
        parsed: { reply: 'hello from AI', actions: [] },
        usage: {},
        costUSD: 0,
    })
})

describe('AI API-key scope enforcement (end-to-end)', () => {
    it('ai-only key gets 200 on an AI generation POST endpoint', async () => {
        seedApiKey(['ai'])

        const res = await request(makeApp())
            .post('/api/ai/chat')
            .set('Authorization', 'Bearer grm_live_ai_only_key')
            .send({ message: 'hello' })

        expect(res.status).toBe(200)
        expect(res.body.reply).toBe('hello from AI')
    })

    it('write-only key gets 403 on an AI generation POST endpoint, naming the "ai" scope', async () => {
        seedApiKey(['write'])

        const res = await request(makeApp())
            .post('/api/ai/chat')
            .set('Authorization', 'Bearer grm_live_write_only_key')
            .send({ message: 'hello' })

        expect(res.status).toBe(403)
        expect(res.body).toEqual({ error: 'Insufficient permissions', required: 'ai' })
        expect(mockGenerate).not.toHaveBeenCalled()
    })

    it('ai-only key gets 403 on a non-AI mutating endpoint (write scope still required)', async () => {
        seedApiKey(['ai'])

        const res = await request(makeApp())
            .post('/api/other-write')
            .set('Authorization', 'Bearer grm_live_ai_only_key_2')
            .send({})

        expect(res.status).toBe(403)
        expect(res.body).toEqual({
            error: 'This API key lacks the required "write" scope',
            required: 'write',
        })
    })

    it('ai-only key gets 403 on a same-shape sibling of a parameterised generation route (deep-review comment PATCH)', async () => {
        // POST /ai/deep-review/:owner/:repo/:pr is a generation route an
        // ai-only key may call. PATCH /ai/deep-review/:draftId/comments/:idx has
        // the same three segments; the carve-out patterns carry their method so
        // that edit still needs `write`.
        seedApiKey(['ai'])

        const res = await request(makeApp())
            .patch('/api/ai/deep-review/12/comments/3')
            .set('Authorization', 'Bearer grm_live_ai_only_deep_review')
            .send({ action: 'dismiss' })

        expect(res.status).toBe(403)
        expect(res.body).toEqual({
            error: 'This API key lacks the required "write" scope',
            required: 'write',
        })
    })

    it('write-only key gets 403 on the Prompt Studio test run (it generates, so it needs `ai`)', async () => {
        seedApiKey(['write'])

        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/1/test')
            .set('Authorization', 'Bearer grm_live_write_only_prompt_test')
            .send({})

        expect(res.status).toBe(403)
        expect(res.body).toEqual({ error: 'Insufficient permissions', required: 'ai' })
    })

    it('admin-scoped key gets 200 on an AI generation POST endpoint', async () => {
        seedApiKey(['admin'])

        const res = await request(makeApp())
            .post('/api/ai/chat')
            .set('Authorization', 'Bearer grm_live_admin_key')
            .send({ message: 'hello' })

        expect(res.status).toBe(200)
    })

    it('session (cookie) user is unaffected and gets 200 on an AI generation POST endpoint', async () => {
        const app = express()
        app.use(express.json())
        app.use((req, _res, next) => {
            req.session = { userId: 7, accessToken: 'ghp_mock' }
            req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
            req.getAIProvider = async () => ({ generate: mockGenerate, model: 'mock-model' })
            next()
        })
        app.use('/api', aiRouter)

        const res = await request(app).post('/api/ai/chat').send({ message: 'hello' })

        expect(res.status).toBe(200)
        // No API-key DB lookup should happen for a session (cookie) request.
        expect(mockPrepare).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// Parity: AI_GENERATION_ROUTE_PATHS ⇄ requireScope('ai') mounts
// ---------------------------------------------------------------------------
// The carve-out in apiKeyAuth and the requireScope('ai') mounts on the AI
// generation routes are two halves of one invariant: every path the carve-out
// lets an ai-only key reach MUST have requireScope('ai') behind it. If they
// drift apart in the fail-open direction — a path added to the allowlist
// without a matching mount, a gated route renamed, or a NEW METHOD registered
// at an allowlisted path without the guard (the carve-out is deliberately
// method-insensitive) — an ai-only key passes the generic write gate with no
// scope check behind it: silent write access. These tests walk the real
// barrel router's layer stack so the invariant is self-enforcing instead of
// relying on code review to keep two lists in sync.

describe('carve-out allowlist / requireScope("ai") parity', () => {
    // Recursively collect every route registered on the router (the four
    // generation sub-routers are mounted at '/', so their route paths are
    // already the '/ai/...' strings the allowlist uses; the prefixed Pro
    // sub-routers contribute only param-style paths that never collide).
    const PREFIXED = new Set(AI_PREFIXED_ROUTERS.map(([, r]) => r))
    function collectRoutes(router, out = []) {
        for (const layer of router.stack) {
            if (PREFIXED.has(layer.handle)) continue
            if (layer.route) {
                const hasAiScope = layer.route.stack.some(
                    (l) => l.handle?.requiredScope === 'ai'
                )
                for (const p of [].concat(layer.route.path)) {
                    out.push({ path: p, hasAiScope })
                }
            } else if (layer.name === 'router' && layer.handle?.stack) {
                collectRoutes(layer.handle, out)
            }
        }
        return out
    }

    // EXPLICIT EXCEPTION — a decision, not drift: GET /ai/search carries
    // requireScope('ai') (it is requireAI-gated, it burns provider tokens)
    // but is deliberately NOT in the carve-out allowlist, because the generic
    // write gate only inspects mutating methods — a GET never needs the
    // carve-out to reach its route middleware. Anything else appearing in
    // this gap must fail the set-equality test below.
    const GATED_BUT_NOT_ALLOWLISTED = ['/ai/search']

    it('every route registered at an allowlisted path carries requireScope("ai") — any method', () => {
        const allow = new Set(AI_GENERATION_ROUTE_PATHS)
        const unguarded = collectRoutes(aiRouter).filter(
            (r) => allow.has(r.path) && !r.hasAiScope
        )
        // A non-empty list here means an ai-only key can pass the generic
        // write gate for these routes with NO scope check behind it.
        expect(unguarded).toEqual([])
    })

    it('requireScope("ai")-gated paths === allowlist + the explicit GET /ai/search exception', () => {
        const gated = [...new Set(
            collectRoutes(aiRouter).filter((r) => r.hasAiScope).map((r) => r.path)
        )].sort()
        const expected = [...new Set(
            [...AI_GENERATION_ROUTE_PATHS, ...GATED_BUT_NOT_ALLOWLISTED]
        )].sort()
        // Fails BOTH drift directions: an allowlist entry with no gated route
        // (fail-open — the dangerous one), and a gated route missing from the
        // allowlist (fail-closed — an ai-only key silently 403s on a route
        // that was meant to accept it).
        expect(gated).toEqual(expected)
    })
})

describe('parameterised generation patterns / requireScope("ai") parity', () => {
    // Every (method, prefixed path) that carries requireScope('ai') in the
    // prefixed sub-routers must be one of AI_GENERATION_ROUTE_PATTERNS and vice
    // versa — the same both-directions guarantee as the exact list above.
    function gatedPrefixedRoutes() {
        const out = []
        for (const [prefix, sub] of AI_PREFIXED_ROUTERS) {
            for (const layer of sub.stack) {
                if (!layer.route) continue
                if (!layer.route.stack.some((l) => l.handle?.requiredScope === 'ai')) continue
                for (const method of Object.keys(layer.route.methods)) {
                    for (const p of [].concat(layer.route.path)) out.push(`${method.toUpperCase()} ${prefix}${p}`)
                }
            }
        }
        return out.sort()
    }

    it('every listed prefixed router is mounted on the barrel, at its prefix', async () => {
        const mounted = aiRouter.stack.filter((l) => l.name === 'router').map((l) => l.handle)
        for (const [prefix, sub] of AI_PREFIXED_ROUTERS) {
            expect(mounted).toContain(sub)
            // And at the prefix the patterns assume: a route of that router
            // answers under it (401 from requireAuth, not a 404).
            const app = express()
            app.use('/api', aiRouter)
            const route = sub.stack.find((l) => l.route)
            const path = `/api${prefix}${route.route.path.replace(/:[^/]+/g, 'x')}`
            const method = Object.keys(route.route.methods)[0]
            const res = await request(app)[method](path)
            expect(res.status).not.toBe(404)
        }
    })

    it('gated prefixed routes === AI_GENERATION_ROUTE_PATTERNS', () => {
        const patterns = AI_GENERATION_ROUTE_PATTERNS.map(({ method, path }) => `${method} ${path}`).sort()
        expect(gatedPrefixedRoutes()).toEqual(patterns)
    })
})

// ---------------------------------------------------------------------------
// The runtime parity gate above walks the ai barrel router ONLY. Three routes
// carry requireScope('ai') outside it, so the barrel walk never sees them and
// its set-equality assertion passes without saying anything about them. They
// are fail-closed today — being absent from AI_GENERATION_ROUTE_PATHS means an
// ai-only key cannot reach them at all — but "the gate is silent here" is
// exactly the property that lets a FOURTH one land unnoticed, and the next one
// might be the fail-open direction.
//
// A source scan rather than a router walk: importing the v1 tree boots the
// database and the whole middleware stack, and the failure mode being guarded
// is a new callsite appearing, which is visible in the source.
// ---------------------------------------------------------------------------
describe('requireScope("ai") outside the ai barrel', () => {
    // Every entry is a deliberate decision, keyed by the exact route it
    // covers rather than by file: the previous version of this gate listed
    // FILES, so a second ai-scoped route added to an already-listed file was
    // invisible to it. Each value is the reason the route is not in
    // AI_GENERATION_ROUTE_PATHS; each callsite repeats it in a comment.
    const INTENTIONALLY_EXCLUDED = {
        'server/routes/migration.js::/analyze':
            'outside the ai barrel — fail-closed: an ai-only key 403s at the generic write gate',
        'server/routes/repos/actions-community.js::/:owner/:repo/agent-rules/generate':
            'outside the ai barrel — fail-closed: an ai-only key 403s at the generic write gate',
        'server/routes/v1/repos-security.js::/repos/:owner/:repo/security/summary':
            'outside the ai barrel — fail-closed: an ai-only key 403s at the generic write gate',
    }

    // A source scan rather than a router walk: importing the v1 tree boots the
    // database and the whole middleware stack, and the failure mode being
    // guarded is a new callsite appearing, which is visible in the source.
    const ROUTE_WITH_AI_SCOPE =
        /router\.(?:get|post|put|patch|delete|all)\(\s*'([^']+)'.*?requireScope\(\s*'ai'\s*\)/g
    const AI_SCOPE_ANY = /requireScope\(\s*'ai'\s*\)/g

    function routeFiles() {
        const dir = 'server/routes'
        return readdirSync(dir, { recursive: true })
            .filter((f) => typeof f === 'string' && f.endsWith('.js'))
            .map((f) => join(dir, f).split(sep).join('/'))
            .filter((f) => !f.startsWith('server/routes/ai/') && f !== 'server/routes/ai.js')
            .sort()
    }

    function scan() {
        const found = []
        let unmatched = 0
        for (const file of routeFiles()) {
            // Comments at each callsite quote requireScope('ai') to explain the
            // exclusion; only code counts.
            const src = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '')
            const declared = (src.match(AI_SCOPE_ANY) || []).length
            if (declared === 0) continue
            const matches = [...src.matchAll(ROUTE_WITH_AI_SCOPE)]
            for (const m of matches) found.push(`${file}::${m[1]}`)
            // A registration spread over several lines would slip past the
            // single-line regex — i.e. fail OPEN. Count instead of trusting it.
            unmatched += declared - matches.length
        }
        return { found: found.sort(), unmatched }
    }

    it('every ai-scoped route callsite is visible to this scan', () => {
        expect(
            scan().unmatched,
            "a requireScope('ai') callsite this regex cannot see — reformat the route registration onto one line, or widen the pattern",
        ).toBe(0)
    })

    it('every ai-scoped route outside the barrel is explicitly excluded from the carve-out', () => {
        const undecided = scan().found.filter((r) => !(r in INTENTIONALLY_EXCLUDED))
        expect(
            undecided,
            'a new ai-scoped route outside the barrel — decide whether it belongs in AI_GENERATION_ROUTE_PATHS, then record it here',
        ).toEqual([])
    })

    it('has no stale exclusions', () => {
        const live = new Set(scan().found)
        expect(
            Object.keys(INTENTIONALLY_EXCLUDED).filter((r) => !live.has(r)),
            "this route no longer carries requireScope('ai') — drop the exclusion",
        ).toEqual([])
    })

    it('each one documents why it is not in the allowlist', () => {
        const files = [...new Set(Object.keys(INTENTIONALLY_EXCLUDED).map((r) => r.split('::')[0]))]
        const undocumented = files.filter(
            (f) => !/AI_GENERATION_ROUTE_PATHS/.test(readFileSync(f, 'utf8')),
        )
        expect(undocumented, 'the callsite must say why it sits outside the carve-out').toEqual([])
    })
})
