// @vitest-environment node
/*
 * Logout must end the session even when another request is still in flight.
 *
 * express-session saves a modified session when its request ends. A poll that
 * loaded the session just before logout (session-info caches isAdmin into it,
 * the CSRF middleware mints a token into it) finished AFTER the destroy and
 * wrote the whole session back, GitHub token included, with a fresh cookie.
 * The user had signed out and was still signed in.
 */
import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import session from 'express-session'
import request from 'supertest'
import Database from 'better-sqlite3'
import { createSQLiteStore } from '../lib/session-store.js'
import { withSessionTombstones } from '../lib/session-tombstones.js'

const stores = []
afterEach(() => { for (const s of stores.splice(0)) clearInterval(s._cleanupTimer) })

function buildApp({ guarded }) {
    const SQLiteStore = createSQLiteStore(session)
    let store = new SQLiteStore(new Database(':memory:'), { cleanupInterval: 3_600_000 })
    stores.push(store)
    if (guarded) store = withSessionTombstones(store)

    let releaseSlow
    let enteredSlow
    const slowEntered = new Promise((r) => { enteredSlow = r })

    const app = express()
    app.use(session({ secret: 'test-secret-for-logout-race', resave: false, saveUninitialized: false, rolling: true, store, cookie: { httpOnly: true, sameSite: 'lax' } }))
    app.post('/login', (req, res) => {
        req.session.userId = 7
        req.session.accessToken = 'gho_test'
        res.json({ ok: true })
    })
    // Stands in for /api/auth/session-info: it writes into the session it loaded.
    app.get('/poll', async (req, res) => {
        enteredSlow()
        await new Promise((r) => { releaseSlow = r })
        req.session.isAdminCache = { value: false, checkedAt: Date.now() }
        res.json({ ok: true })
    })
    app.post('/logout', (req, res) => {
        req.session.destroy(() => {
            res.clearCookie('connect.sid', { path: '/', httpOnly: true, sameSite: 'lax' })
            res.json({ ok: true })
        })
    })
    app.get('/whoami', (req, res) => res.json({ signedIn: Boolean(req.session?.accessToken) }))
    return { app, store, slowEntered, release: () => releaseSlow() }
}

async function raceLogoutAgainstPoll({ guarded }) {
    const { app, slowEntered, release } = buildApp({ guarded })
    const agent = request.agent(app)
    await agent.post('/login').expect(200)
    const cookie = agent.jar.getCookie('connect.sid', { path: '/', domain: '127.0.0.1', secure: false, script: false })
        ?? null
    const poll = agent.get('/poll')
    const pollDone = poll.then((r) => r)
    await slowEntered
    await agent.post('/logout').expect(200)
    release()
    await pollDone
    // The browser keeps whatever cookie arrived last; replay the pre-logout one
    // too, since the poll's Set-Cookie can land after the logout's clear.
    const viaJar = (await agent.get('/whoami')).body.signedIn
    const viaOldCookie = cookie
        ? (await request(app).get('/whoami').set('Cookie', `connect.sid=${cookie.value}`)).body.signedIn
        : false
    return viaJar || viaOldCookie
}

describe('logout while a request is in flight', () => {
    it('without tombstones the poll resurrects the destroyed session (the bug)', async () => {
        expect(await raceLogoutAgainstPoll({ guarded: false })).toBe(true)
    })

    it('with tombstones the session stays ended', async () => {
        expect(await raceLogoutAgainstPoll({ guarded: true })).toBe(false)
    })

    it('a brand-new session after logout still saves normally', async () => {
        const { app } = buildApp({ guarded: true })
        const agent = request.agent(app)
        await agent.post('/login').expect(200)
        await agent.post('/logout').expect(200)
        await agent.post('/login').expect(200)
        expect((await agent.get('/whoami')).body.signedIn).toBe(true)
    })
})
