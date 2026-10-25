// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs. Licensed under the Apache License 2.0.

/**
 * The self-hosted side of the licence check-in.
 *
 * Once a day (and right after a key is activated) an installation with a
 * licence sends the key, its own random install id, a name and its version to
 * the issuer. It gets back the newest key of the subscription, which it
 * verifies locally and installs (automatic renewal), the subscription's
 * revoked key ids, which it adds to its own revocation list, and the
 * installation count against what the plan covers.
 *
 * Validation itself never depends on this: a key is checked offline, and an
 * installation that cannot reach the issuer keeps working until the key's own
 * end date. LICENSE_AUTO_RENEW=false turns the check-in off entirely
 * (air-gapped installations paste each renewed key by hand).
 */

import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { hostname } from 'node:os'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import db from '../db.js'
import { config } from '../config.js'
import logger from './logger.js'
import { verifyLicenseKey, revokeLicense, parseLicenseKey } from './license.js'
import { getStoredLicense, setStoredLicense } from './license-store.js'
import { refreshLicenseCache } from '../middleware/require-tier.js'

const APP_VERSION = createRequire(import.meta.url)('../../package.json').version
const DAY_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 10_000
const STATE_KEY = 'license_checkin'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicKeyPath = join(__dirname, '..', '..', 'keys', 'public.pem')
const PUBLIC_KEY = existsSync(publicKeyPath) ? readFileSync(publicKeyPath, 'utf-8') : null

export function renewalUrl() {
    const raw = process.env.LICENSE_RENEWAL_URL?.trim()
    return raw && /^https:\/\/[^\s"<>]+$/.test(raw) ? raw.replace(/\/+$/, '') : 'https://repomanager.bolalabs.pt'
}

function meta(key) {
    return db.prepare('SELECT value FROM system_meta WHERE key = ?').get(key)?.value ?? null
}

function setMeta(key, value) {
    db.prepare(`
        INSERT INTO system_meta (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value)
}

/** This installation's id: random, generated once, never derived from the machine. */
export function installId() {
    let id = meta('install_id')
    if (!id) {
        id = randomUUID()
        setMeta('install_id', id)
    }
    return id
}

/** The last check-in outcome, for Settings → License & Plan. */
export function lastCheckin() {
    try { return JSON.parse(meta(STATE_KEY) || 'null') } catch { return null }
}

/** Why this installation does not check in, or null when it does. */
export function checkinDisabledReason() {
    if (process.env.LICENSE_AUTO_RENEW?.trim().toLowerCase() === 'false') return 'disabled'
    // The hosted service issues keys; it has nobody to check in with.
    if (config.deploymentMode === 'saas' || process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM) return 'issuer'
    // Unit tests and the mock-mode e2e server must never call the real issuer.
    if (config.nodeEnv === 'test') return 'test'
    return null
}

/**
 * One check-in. Never throws: every outcome, including "could not reach the
 * issuer", is recorded and returned.
 *
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 */
export async function checkInOnce({ fetchImpl = globalThis.fetch } = {}) {
    const disabled = checkinDisabledReason()
    if (disabled) return { skipped: disabled }

    const envKey = config.licenseKey || null
    const stored = getStoredLicense()
    const key = envKey || stored?.licenseKey
    if (!key) return { skipped: 'no-licence' }

    const state = { at: new Date().toISOString() }
    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
        let res
        try {
            res = await fetchImpl(`${renewalUrl()}/api/v1/license/checkin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key,
                    installId: installId(),
                    name: (process.env.LICENSE_INSTALL_NAME || hostname()).slice(0, 80),
                    version: APP_VERSION,
                }),
                signal: controller.signal,
            })
        } finally {
            clearTimeout(timer)
        }
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.data) {
            state.error = body?.code || `http_${res.status}`
            return record(state)
        }
        const data = body.data
        state.status = data.status
        state.installs = data.installs ?? null

        // Revocations first: a revoked current key must stop working here too.
        const current = parseLicenseKey(key)
        let changed = false
        for (const lid of Array.isArray(data.revoked) ? data.revoked : []) {
            if (typeof lid !== 'string') continue
            revokeLicense(db, { lid, reason: 'Revoked by the issuer (check-in)' })
            changed = true
        }

        if (typeof data.latestKey === 'string' && PUBLIC_KEY) {
            const verified = await verifyLicenseKey(data.latestKey, () => PUBLIC_KEY)
            const newer = verified.ok && (!current?.exp || (verified.payload.exp ?? 0) > current.exp)
            if (newer && envKey) {
                // An env-pinned key cannot be replaced from here; say so.
                state.renewalPending = true
            } else if (newer) {
                setStoredLicense(data.latestKey, verified.payload, null)
                state.renewedTo = new Date(verified.payload.exp * 1000).toISOString()
                changed = true
            }
        }
        if (changed) await refreshLicenseCache()
        if (state.installs?.over) {
            logger.warn(state.installs, 'licence check-in: this key is active on more installations than the plan covers')
        }
    } catch (err) {
        state.error = err?.name === 'AbortError' ? 'timeout' : 'unreachable'
    }
    return record(state)
}

function record(state) {
    try { setMeta(STATE_KEY, JSON.stringify(state)) } catch (err) { logger.warn({ err }, 'licence check-in: could not save the outcome') }
    return state
}

let timer = null
let firstRun = null

/** Daily check-in, first run a minute after boot. Safe to call when disabled. */
export function startLicenseCheckin() {
    if (checkinDisabledReason() || timer) return
    firstRun = setTimeout(() => { checkInOnce() }, 60_000)
    firstRun.unref?.()
    timer = setInterval(() => { checkInOnce() }, DAY_MS)
    timer.unref?.()
}

export function stopLicenseCheckin() {
    clearTimeout(firstRun)
    clearInterval(timer)
    firstRun = null
    timer = null
}
