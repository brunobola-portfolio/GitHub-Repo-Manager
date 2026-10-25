// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs. Licensed under the Apache License 2.0.

/**
 * The issuer's side of the licence check-in: which installations use a
 * subscription's keys, the newest key an installation should run, which of
 * the subscription's keys were revoked, and what the operator did about an
 * installation (blocked it from renewals).
 *
 * A licence covers a number of MACHINES: one plus a spare on Pro (staging, a
 * migration, a rebuilt server). An installation is identified by its own
 * random install id; the machine by a salted hash of the OS machine id when
 * the installation can read one (Docker without the host's id cannot, and
 * then each installation counts as its own machine). A reinstall on the same
 * machine is therefore not a second machine.
 *
 * Going over is recorded and shown, never refused: a key that stopped working
 * because a server was rebuilt would hurt the people the limit exists to
 * protect. Far over the limit is audited once as suspected sharing, and the
 * operator answers it with the two tools below: block an installation from
 * renewals, or rotate the key and keep only the installations they trust.
 */

import { createHash } from 'node:crypto'
import db from '../db.js'

/** Installations seen in this many days count as active. */
export const ACTIVE_DAYS = 30

/** Machine hashes as the installation sends them: sha256 hex. */
export const MACHINE_HASH = /^[0-9a-f]{64}$/

function envInt(name, fallback) {
    const n = Number.parseInt(process.env[name] ?? '', 10)
    return Number.isFinite(n) && n >= 1 ? n : fallback
}

/** How many active machines a key of this tier covers. */
export function installLimit(tier) {
    if (tier === 'enterprise') return envInt('LICENSE_INSTALLS_ENTERPRISE', 10)
    if (tier === 'pro') return envInt('LICENSE_INSTALLS_PRO', 2)
    return 1
}

/**
 * ok: within the plan. over: above it, which a spare machine or a migration
 * explains. suspected: more than twice the plan, which they do not.
 */
export function sharingLevel(active, limit) {
    if (active <= limit) return 'ok'
    return active > limit * 2 ? 'suspected' : 'over'
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

const ACTIVE = "julianday(last_seen) >= julianday('now') - @days"

/**
 * Record one check-in.
 *
 * A new installation on a machine the operator blocked starts blocked: a
 * wiped data volume must not be a way around a block.
 *
 * @param {{ subRef: string, lid: string, tier?: string|null, installId: string, machine?: string|null, platform?: string|null, name?: string|null, ip?: string, version?: string|null }} c
 * @returns {{ seq: number, blocked: boolean, active: number }}
 */
export function recordCheckin({ subRef, lid, tier = null, installId, machine = null, platform = null, name = null, ip, version = null }) {
    const installHash = createHash('sha256').update(String(installId)).digest('hex')
    const machineHash = machine && MACHINE_HASH.test(machine) ? machine : null
    const row = db.transaction(() => {
        const inheritedBlock = machineHash
            ? db.prepare(`
                SELECT blocked_at, blocked_reason FROM license_installs
                WHERE sub_ref = ? AND machine_hash = ? AND blocked_at IS NOT NULL
                ORDER BY blocked_at DESC LIMIT 1
            `).get(subRef, machineHash)
            : null
        db.prepare(`
            INSERT INTO license_installs
                (sub_ref, lid, tier, install_hash, machine_hash, platform, name, ip_prefix, app_version, seq, blocked_at, blocked_reason)
            VALUES (@subRef, @lid, @tier, @installHash, @machineHash, @platform, @name, @ipPrefix, @version,
                (SELECT COALESCE(MAX(seq), 0) + 1 FROM license_installs WHERE sub_ref = @subRef),
                @blockedAt, @blockedReason)
            ON CONFLICT(sub_ref, install_hash) DO UPDATE SET
                lid = excluded.lid, tier = excluded.tier, machine_hash = COALESCE(excluded.machine_hash, license_installs.machine_hash),
                platform = excluded.platform, name = excluded.name, ip_prefix = excluded.ip_prefix,
                app_version = excluded.app_version, last_seen = datetime('now')
        `).run({
            subRef, lid, tier, installHash, machineHash, platform, name, ipPrefix: ipPrefix(ip), version,
            blockedAt: inheritedBlock?.blocked_at ?? null,
            blockedReason: inheritedBlock?.blocked_reason ?? null,
        })
        return db.prepare('SELECT seq, blocked_at FROM license_installs WHERE sub_ref = ? AND install_hash = ?')
            .get(subRef, installHash)
    })()
    return { seq: row.seq, blocked: Boolean(row.blocked_at), active: countActive(subRef) }
}

/**
 * Active MACHINES of a subscription. A blocked installation does not count:
 * the operator has already dealt with it.
 */
export function countActive(subRef) {
    return db.prepare(`
        SELECT COUNT(DISTINCT COALESCE(machine_hash, install_hash)) AS n FROM license_installs
        WHERE sub_ref = @subRef AND blocked_at IS NULL AND ${ACTIVE}
    `).get({ subRef, days: ACTIVE_DAYS }).n
}

/**
 * Store the subscription's sharing level and say whether it just rose to
 * `suspected`, so the caller audits an escalation once, not daily.
 */
export function noteSharingLevel(subRef, level) {
    const prev = db.prepare('SELECT level FROM license_alerts WHERE sub_ref = ?').get(subRef)?.level ?? 'ok'
    if (prev === level) return false
    db.prepare(`
        INSERT INTO license_alerts (sub_ref, level, changed_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(sub_ref) DO UPDATE SET level = excluded.level, changed_at = excluded.changed_at
    `).run(subRef, level)
    return level === 'suspected'
}

/** Installations of a subscription, newest first, for the operator. */
export function listInstalls(subRef) {
    return db.prepare(`
        SELECT seq, name, platform, ip_prefix AS network, app_version AS version, lid,
               substr(machine_hash, 1, 12) AS machine, first_seen, last_seen,
               blocked_at, blocked_reason, ${ACTIVE} AS active
        FROM license_installs WHERE sub_ref = @subRef ORDER BY last_seen DESC
    `).all({ subRef, days: ACTIVE_DAYS }).map((r) => ({ ...r, active: Boolean(r.active) }))
}

/**
 * Every subscription that has issued keys or check-ins, with what the
 * operator needs to spot a shared key: holder, plan, active machines against
 * the plan, distinct networks, and the sharing level.
 */
export function listLicenses() {
    const subs = db.prepare(`
        SELECT i.stripe_subscription_id AS sub_ref, i.tier, i.org, i.expires_at, i.lid, u.email, u.username
        FROM issued_licenses i
        LEFT JOIN users u ON u.id = i.user_id
        WHERE i.id = (
            SELECT id FROM issued_licenses j WHERE j.stripe_subscription_id = i.stripe_subscription_id
            ORDER BY (j.revoked_at IS NULL) DESC, julianday(j.expires_at) DESC, j.id DESC LIMIT 1
        )
    `).all()
    // Keys minted outside Stripe check in under 'lid:<id>' and have no issued row.
    const standalone = db.prepare(`
        SELECT sub_ref, MAX(tier) AS tier, MAX(lid) AS lid FROM license_installs
        WHERE sub_ref LIKE 'lid:%' GROUP BY sub_ref
    `).all().map((r) => ({ ...r, org: null, expires_at: null, email: null, username: null }))
    const stats = db.prepare(`
        SELECT COUNT(DISTINCT CASE WHEN blocked_at IS NULL AND ${ACTIVE} THEN COALESCE(machine_hash, install_hash) END) AS machines,
               COUNT(DISTINCT CASE WHEN ${ACTIVE} THEN ip_prefix END) AS networks,
               SUM(CASE WHEN blocked_at IS NOT NULL THEN 1 ELSE 0 END) AS blocked,
               COUNT(*) AS installations, MAX(last_seen) AS last_seen
        FROM license_installs WHERE sub_ref = @subRef
    `)
    return [...subs, ...standalone].map((s) => {
        const st = stats.get({ subRef: s.sub_ref, days: ACTIVE_DAYS })
        const limit = installLimit(s.tier)
        return {
            subRef: s.sub_ref,
            tier: s.tier,
            org: s.org,
            holder: s.email || s.username || null,
            expiresAt: s.expires_at,
            lid: s.lid,
            machines: st.machines,
            limit,
            level: sharingLevel(st.machines, limit),
            networks: st.networks,
            installations: st.installations,
            blocked: st.blocked ?? 0,
            lastSeen: st.last_seen,
        }
    }).sort((a, b) => (LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]) || String(b.lastSeen ?? '').localeCompare(String(a.lastSeen ?? '')))
}

const LEVEL_ORDER = { ok: 0, over: 1, suspected: 2 }

/**
 * Block an installation from renewals, and every other installation of the
 * same machine with it. The key it holds keeps working until its own end date
 * (at most the paid period plus grace); it simply never gets the next one.
 *
 * @returns {number} installations blocked
 */
export function blockInstall(subRef, seq, reason) {
    const target = db.prepare('SELECT machine_hash FROM license_installs WHERE sub_ref = ? AND seq = ?').get(subRef, seq)
    if (!target) return 0
    const info = target.machine_hash
        ? db.prepare(`
            UPDATE license_installs SET blocked_at = datetime('now'), blocked_reason = ?
            WHERE sub_ref = ? AND (seq = ? OR machine_hash = ?) AND blocked_at IS NULL
        `).run(reason, subRef, seq, target.machine_hash)
        : db.prepare(`
            UPDATE license_installs SET blocked_at = datetime('now'), blocked_reason = ?
            WHERE sub_ref = ? AND seq = ? AND blocked_at IS NULL
        `).run(reason, subRef, seq)
    return info.changes
}

/** Lift a block, for the installation and the rest of its machine. */
export function unblockInstall(subRef, seq) {
    const target = db.prepare('SELECT machine_hash FROM license_installs WHERE sub_ref = ? AND seq = ?').get(subRef, seq)
    if (!target) return 0
    const info = target.machine_hash
        ? db.prepare(`
            UPDATE license_installs SET blocked_at = NULL, blocked_reason = NULL
            WHERE sub_ref = ? AND (seq = ? OR machine_hash = ?)
        `).run(subRef, seq, target.machine_hash)
        : db.prepare('UPDATE license_installs SET blocked_at = NULL, blocked_reason = NULL WHERE sub_ref = ? AND seq = ?')
            .run(subRef, seq)
    return info.changes
}

/** Active installations of a subscription, for "which do you keep?". */
export function activeInstallSeqs(subRef) {
    return db.prepare(`SELECT seq FROM license_installs WHERE sub_ref = @subRef AND blocked_at IS NULL AND ${ACTIVE}`)
        .all({ subRef, days: ACTIVE_DAYS }).map((r) => r.seq)
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

/** Why a key of this subscription was revoked, or null when it was not. */
export function revokeReasonOf(lid) {
    return db.prepare('SELECT revoke_reason FROM issued_licenses WHERE lid = ? AND revoked_at IS NOT NULL').get(lid)?.revoke_reason ?? null
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
