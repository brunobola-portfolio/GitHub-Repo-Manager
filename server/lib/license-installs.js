// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs. Licensed under the Apache License 2.0.

/**
 * The issuer's side of the licence check-in: which installations use a
 * subscription's keys, the newest key an installation should run, and which
 * of the subscription's keys were revoked.
 *
 * A licence covers one installation plus a spare (staging, a migration, a
 * rebuilt server). Going over is recorded and shown, never blocked: a key
 * that stopped working because a server was rebuilt would hurt the people
 * the limit exists to protect.
 */

import { createHash } from 'node:crypto'
import db from '../db.js'

/** Installations seen in this many days count as active. */
export const ACTIVE_DAYS = 30

function envInt(name, fallback) {
    const n = Number.parseInt(process.env[name] ?? '', 10)
    return Number.isFinite(n) && n >= 1 ? n : fallback
}

/** How many active installations a key of this tier covers. */
export function installLimit(tier) {
    if (tier === 'enterprise') return envInt('LICENSE_INSTALLS_ENTERPRISE', 10)
    if (tier === 'pro') return envInt('LICENSE_INSTALLS_PRO', 2)
    return 1
}

/**
 * The network an installation called from, coarse enough not to identify a
 * person: an IPv4 /24 or an IPv6 /48.
 */
export function ipPrefix(ip) {
    const raw = String(ip ?? '').replace(/^::ffff:/, '')
    const v4 = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/)
    if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`
    if (raw.includes(':')) {
        const parts = raw.split(':').filter((p, i, a) => p !== '' || i === 0 || i === a.length - 1)
        return `${parts.slice(0, 3).join(':')}::/48`
    }
    return null
}

/** Which subscription a key belongs to; a key minted outside Stripe stands alone. */
export function subscriptionRefFor(lid) {
    const row = lid
        ? db.prepare('SELECT stripe_subscription_id FROM issued_licenses WHERE lid = ?').get(lid)
        : null
    return row?.stripe_subscription_id || `lid:${lid}`
}

/**
 * Record one check-in and return the active count.
 *
 * @param {{ subRef: string, lid: string, installId: string, name?: string|null, ip?: string, version?: string|null }} c
 * @returns {{ active: number }}
 */
export function recordCheckin({ subRef, lid, installId, name = null, ip, version = null }) {
    const installHash = createHash('sha256').update(String(installId)).digest('hex')
    db.prepare(`
        INSERT INTO license_installs (sub_ref, lid, install_hash, name, ip_prefix, app_version)
        VALUES (@subRef, @lid, @installHash, @name, @ipPrefix, @version)
        ON CONFLICT(sub_ref, install_hash) DO UPDATE SET
            lid = excluded.lid, name = excluded.name, ip_prefix = excluded.ip_prefix,
            app_version = excluded.app_version, last_seen = datetime('now')
    `).run({ subRef, lid, installHash, name, ipPrefix: ipPrefix(ip), version })
    return { active: countActive(subRef) }
}

export function countActive(subRef) {
    return db.prepare(`
        SELECT COUNT(*) AS n FROM license_installs
        WHERE sub_ref = ? AND julianday(last_seen) >= julianday('now') - ?
    `).get(subRef, ACTIVE_DAYS).n
}

/** Installations of a subscription, newest first, for the operator. */
export function listInstalls(subRef) {
    return db.prepare(`
        SELECT name, ip_prefix, app_version, first_seen, last_seen,
               julianday(last_seen) >= julianday('now') - ? AS active
        FROM license_installs WHERE sub_ref = ? ORDER BY last_seen DESC
    `).all(ACTIVE_DAYS, subRef)
}

/**
 * The key an installation should be running: the newest one of the
 * subscription that is neither revoked nor expired, when it differs from the
 * key presented. null when the presented key is already the newest.
 */
export function newerKeyFor(subRef, presentedLid) {
    if (subRef.startsWith('lid:')) return null
    const row = db.prepare(`
        SELECT license_key, lid FROM issued_licenses
        WHERE stripe_subscription_id = ? AND revoked_at IS NULL AND lid IS NOT NULL
          AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
        ORDER BY julianday(expires_at) DESC, id DESC LIMIT 1
    `).get(subRef)
    if (!row || row.lid === presentedLid) return null
    return { key: row.license_key, lid: row.lid }
}

/** Revoked key ids of the subscription (or of the standalone key). */
export function revokedLidsFor(subRef, presentedLid) {
    if (subRef.startsWith('lid:')) {
        const hit = db.prepare('SELECT lid FROM revoked_licenses WHERE lid = ?').get(presentedLid)
        return hit ? [hit.lid] : []
    }
    return db.prepare(`
        SELECT r.lid FROM revoked_licenses r JOIN issued_licenses i ON i.lid = r.lid
        WHERE i.stripe_subscription_id = ?
    `).all(subRef).map((r) => r.lid)
}
