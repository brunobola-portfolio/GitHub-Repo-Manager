// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import session from 'express-session'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Same mock surface as auth.test.js — auth-setup.js pulls in routes/auth.js
// (for resolveFrontendUrl), which imports db/config/audit/limiters.
vi.mock('../config.js', () => {
    const cfg = { nodeEnv: 'development' }
    return { config: cfg, default: cfg }
})
vi.mock('../db.js', () => ({
    default: {
        prepare: () => ({ run: () => {}, get: () => null, all: () => [] }),
    },
}))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
vi.mock('../middleware/tenant-rate-limit.js', () => ({
    createAuthRouteLimiter: () => (_req, _res, next) => next(),
}))
// The route-level limiter instance is module-scoped and would otherwise count
// requests ACROSS tests in this file — neutralize it; limits aren't under test.
vi.mock('express-rate-limit', () => ({ default: () => (_req, _res, next) => next() }))

import authSetupRouter from '../routes/auth-setup.js'
import { updateEnvFile } from '../lib/env-file.js'

const CSRF_TOKEN = 'test-csrf-token'
const ENV_KEYS = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GRM_ENV_FILE', 'GRM_DISABLE_WEB_SETUP', 'FRONTEND_URL']

function buildApp() {
    const app = express()
    app.use(express.json())
    app.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false, httpOnly: true, sameSite: 'lax' },
    }))
    // Seed a CSRF token into the session the same way /api/auth/csrf-token would.
    app.post('/__seed-csrf', (req, res) => {
        req.session.csrfToken = CSRF_TOKEN
        req.session.save(() => res.json({ ok: true }))
    })
    app.use('/api/auth', authSetupRouter)
    return app
}

describe('GET /api/auth/setup-status', () => {
    const savedEnv = {}
    beforeEach(() => {
        for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
    })
    afterEach(() => {
        for (const k of ENV_KEYS) {
            if (savedEnv[k] === undefined) delete process.env[k]
            else process.env[k] = savedEnv[k]
        }
    })

    it('unconfigured loopback install → configurable, with exact same-origin URLs', async () => {
        const res = await request(buildApp()).get('/api/auth/setup-status')
        expect(res.status).toBe(200)
        expect(res.body.oauthConfigured).toBe(false)
        expect(res.body.setupDisabled).toBe(false)
        expect(res.body.canConfigure).toBe(true)
        expect(res.body.homepageUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
        expect(res.body.callbackUrl).toBe(`${res.body.homepageUrl}/api/auth/callback`)
    })

    it('request that crossed a proxy (X-Forwarded-For) → not configurable', async () => {
        const res = await request(buildApp())
            .get('/api/auth/setup-status')
            .set('X-Forwarded-For', '203.0.113.7')
        expect(res.status).toBe(200)
        expect(res.body.canConfigure).toBe(false)
    })

    it('DNS-rebinding shape (loopback socket, foreign Host) → not configurable', async () => {
        const res = await request(buildApp())
            .get('/api/auth/setup-status')
            .set('Host', 'attacker.example.com')
        expect(res.status).toBe(200)
        expect(res.body.canConfigure).toBe(false)
    })

    it('already configured → reports configured, never configurable', async () => {
        process.env.GITHUB_CLIENT_ID = 'id-1234567890'
        process.env.GITHUB_CLIENT_SECRET = 's'.repeat(40)
        const res = await request(buildApp()).get('/api/auth/setup-status')
        expect(res.body.oauthConfigured).toBe(true)
        expect(res.body.canConfigure).toBe(false)
    })

    it('GRM_DISABLE_WEB_SETUP=true → not configurable', async () => {
        process.env.GRM_DISABLE_WEB_SETUP = 'true'
        const res = await request(buildApp()).get('/api/auth/setup-status')
        expect(res.body.setupDisabled).toBe(true)
        expect(res.body.canConfigure).toBe(false)
    })
})

describe('POST /api/auth/setup-oauth', () => {
    const savedEnv = {}
    let tmpDir

    const VALID = {
        clientId: 'Ov23liAbCdEf12345678',
        clientSecret: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    }

    beforeEach(() => {
        for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grm-auth-setup-'))
        process.env.GRM_ENV_FILE = path.join(tmpDir, '.env')
    })
    afterEach(() => {
        for (const k of ENV_KEYS) {
            if (savedEnv[k] === undefined) delete process.env[k]
            else process.env[k] = savedEnv[k]
        }
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    async function seededAgent() {
        const agent = request.agent(buildApp())
        await agent.post('/__seed-csrf')
        return agent
    }

    it('happy path: persists to the env file, applies live, returns the callback URL', async () => {
        const agent = await seededAgent()
        const res = await agent
            .post('/api/auth/setup-oauth')
            .set('X-CSRF-Token', CSRF_TOKEN)
            .send(VALID)
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/auth\/callback$/)

        // Applied live — the running process can complete a login immediately.
        expect(process.env.GITHUB_CLIENT_ID).toBe(VALID.clientId)
        expect(process.env.GITHUB_CLIENT_SECRET).toBe(VALID.clientSecret)

        // Persisted — a restart keeps working.
        const written = fs.readFileSync(process.env.GRM_ENV_FILE, 'utf8')
        expect(written).toContain(`GITHUB_CLIENT_ID=${VALID.clientId}`)
        expect(written).toContain(`GITHUB_CLIENT_SECRET=${VALID.clientSecret}`)

        // And the status flips to configured / no-longer-configurable.
        const status = await agent.get('/api/auth/setup-status')
        expect(status.body.oauthConfigured).toBe(true)
        expect(status.body.canConfigure).toBe(false)
    })

    it('preserves existing .env content (secrets, comments) when updating', async () => {
        fs.writeFileSync(process.env.GRM_ENV_FILE, '# generated header\nSESSION_SECRET=keep-me\nPORT=3001\n')
        const agent = await seededAgent()
        const res = await agent
            .post('/api/auth/setup-oauth')
            .set('X-CSRF-Token', CSRF_TOKEN)
            .send(VALID)
        expect(res.status).toBe(200)
        const written = fs.readFileSync(process.env.GRM_ENV_FILE, 'utf8')
        expect(written).toContain('# generated header')
        expect(written).toContain('SESSION_SECRET=keep-me')
        expect(written).toContain('PORT=3001')
        expect(written).toContain(`GITHUB_CLIENT_ID=${VALID.clientId}`)
    })

    it('missing CSRF token → 403 csrf_invalid, nothing written', async () => {
        const agent = await seededAgent()
        const res = await agent.post('/api/auth/setup-oauth').send(VALID)
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('csrf_invalid')
        expect(fs.existsSync(process.env.GRM_ENV_FILE)).toBe(false)
        expect(process.env.GITHUB_CLIENT_ID).toBeUndefined()
    })

    it('already configured → 409, existing credentials untouched', async () => {
        process.env.GITHUB_CLIENT_ID = 'existing-client-id-123'
        process.env.GITHUB_CLIENT_SECRET = 'e'.repeat(40)
        const agent = await seededAgent()
        const res = await agent
            .post('/api/auth/setup-oauth')
            .set('X-CSRF-Token', CSRF_TOKEN)
            .send(VALID)
        expect(res.status).toBe(409)
        expect(process.env.GITHUB_CLIENT_ID).toBe('existing-client-id-123')
    })

    it('request that crossed a proxy → 403, nothing written', async () => {
        const agent = await seededAgent()
        const res = await agent
            .post('/api/auth/setup-oauth')
            .set('X-CSRF-Token', CSRF_TOKEN)
            .set('X-Forwarded-For', '203.0.113.7')
            .send(VALID)
        expect(res.status).toBe(403)
        expect(fs.existsSync(process.env.GRM_ENV_FILE)).toBe(false)
    })

    it('DNS-rebinding shape (loopback socket, foreign Host) → 403 even with a valid CSRF token', async () => {
        // A rebound origin CAN complete the csrf-token dance itself (its
        // session cookie is keyed to the attacker's domain), so the Host
        // allowlist is the layer that must hold.
        const agent = await seededAgent()
        const res = await agent
            .post('/api/auth/setup-oauth')
            .set('X-CSRF-Token', CSRF_TOKEN)
            .set('Host', 'attacker.example.com')
            .send(VALID)
        expect(res.status).toBe(403)
        expect(fs.existsSync(process.env.GRM_ENV_FILE)).toBe(false)
        expect(process.env.GITHUB_CLIENT_ID).toBeUndefined()
    })

    it('localhost Host name is accepted (dev browsers use it interchangeably with 127.0.0.1)', async () => {
        const agent = await seededAgent()
        const res = await agent
            .post('/api/auth/setup-oauth')
            .set('X-CSRF-Token', CSRF_TOKEN)
            .set('Host', 'localhost:3001')
            .send(VALID)
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })

    it('GRM_DISABLE_WEB_SETUP=true → 403 even from loopback with CSRF', async () => {
        process.env.GRM_DISABLE_WEB_SETUP = 'true'
        const agent = await seededAgent()
        const res = await agent
            .post('/api/auth/setup-oauth')
            .set('X-CSRF-Token', CSRF_TOKEN)
            .send(VALID)
        expect(res.status).toBe(403)
    })

    it.each([
        ['too-short client id', { ...VALID, clientId: 'short' }],
        ['client id with spaces', { ...VALID, clientId: 'has spaces here!!' }],
        ['too-short secret', { ...VALID, clientSecret: 'tiny' }],
        ['secret with newline', { ...VALID, clientSecret: `${'a'.repeat(30)}\nEVIL=1` }],
        ['missing body', {}],
    ])('rejects malformed input: %s → 400, nothing written', async (_label, body) => {
        const agent = await seededAgent()
        const res = await agent
            .post('/api/auth/setup-oauth')
            .set('X-CSRF-Token', CSRF_TOKEN)
            .send(body)
        expect(res.status).toBe(400)
        expect(fs.existsSync(process.env.GRM_ENV_FILE)).toBe(false)
        expect(process.env.GITHUB_CLIENT_ID).toBeUndefined()
    })
})

describe('lib/env-file updateEnvFile', () => {
    let tmpDir
    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grm-env-file-')) })
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

    it('replaces an existing key in place, preserving everything else byte-for-byte', () => {
        const envPath = path.join(tmpDir, '.env')
        fs.writeFileSync(envPath, '# header\nGITHUB_CLIENT_ID=old-value-123\nPORT=3001\n')
        updateEnvFile({ GITHUB_CLIENT_ID: 'new-value-456' }, { envPath })
        expect(fs.readFileSync(envPath, 'utf8'))
            .toBe('# header\nGITHUB_CLIENT_ID=new-value-456\nPORT=3001\n')
    })

    it('appends missing keys under a marker comment, creating the file when absent', () => {
        const envPath = path.join(tmpDir, 'nested', '.env')
        const { created } = updateEnvFile({ GITHUB_CLIENT_ID: 'abc-123-def-456' }, { envPath })
        expect(created).toBe(true)
        const content = fs.readFileSync(envPath, 'utf8')
        expect(content).toContain('# Added by the in-app GitHub connection setup.')
        expect(content).toContain('GITHUB_CLIENT_ID=abc-123-def-456')
        expect(content.endsWith('\n')).toBe(true)
    })

    it('refuses non-allowlisted keys — this writer must never touch other secrets', () => {
        const envPath = path.join(tmpDir, '.env')
        expect(() => updateEnvFile({ SESSION_SECRET: 'attacker' }, { envPath })).toThrow(/allowlisted/)
        expect(fs.existsSync(envPath)).toBe(false)
    })

    it('refuses values containing newlines (env-file injection)', () => {
        const envPath = path.join(tmpDir, '.env')
        expect(() => updateEnvFile({ GITHUB_CLIENT_ID: 'a\nEVIL=1' }, { envPath })).toThrow(/newline/)
        expect(fs.existsSync(envPath)).toBe(false)
    })

    it('leaves no temp files behind after a successful write', () => {
        const envPath = path.join(tmpDir, '.env')
        updateEnvFile({ GITHUB_CLIENT_ID: 'abc-123-def-456' }, { envPath })
        expect(fs.readdirSync(tmpDir)).toEqual(['.env'])
    })
})
