// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.

// Singleton store for a hot-activated license. Lets an operator install a
// license from the UI without restarting the server (Migration 021). The
// process-level cache in require-tier.js still owns the validated payload;
// this module only handles persistence.

import db from '../db.js'

/**
 * Read the currently installed license from the DB.
 * @returns {{
 *   licenseKey: string,
 *   tier: string,
 *   org: string|null,
 *   email: string|null,
 *   seats: number|null,
 *   issuedAt: string|null,
 *   expiresAt: string|null,
 *   installedAt: string,
 *   installedBy: number|null,
 * } | null}
 */
export function getStoredLicense() {
    const row = db.prepare(
        `SELECT license_key, tier, org, email, seats,
                issued_at, expires_at, installed_at, installed_by
           FROM installed_license WHERE id = 1`
    ).get()
    if (!row) return null
    return {
        licenseKey: row.license_key,
        tier: row.tier,
        org: row.org,
        email: row.email,
        seats: row.seats,
        issuedAt: row.issued_at,
        expiresAt: row.expires_at,
        installedAt: row.installed_at,
        installedBy: row.installed_by,
    }
}

/**
 * UPSERT the installed license. Overwrites any prior entry — only one
 * license can be active server-wide at a time.
 *
 * @param {string} licenseKey  the raw signed JWT
 * @param {object} payload     validated payload from validateLicenseKey()
 * @param {number|null} userId actor who triggered the install
 */
export function setStoredLicense(licenseKey, payload, userId) {
    const issuedAt = payload?.iat ? new Date(payload.iat * 1000).toISOString() : null
    const expiresAt = payload?.exp ? new Date(payload.exp * 1000).toISOString() : null
    db.prepare(
        `INSERT INTO installed_license
            (id, license_key, tier, org, email, seats, issued_at, expires_at, installed_at, installed_by)
         VALUES
            (1, @key, @tier, @org, @email, @seats, @issuedAt, @expiresAt, CURRENT_TIMESTAMP, @userId)
         ON CONFLICT(id) DO UPDATE SET
            license_key  = excluded.license_key,
            tier         = excluded.tier,
            org          = excluded.org,
            email        = excluded.email,
            seats        = excluded.seats,
            issued_at    = excluded.issued_at,
            expires_at   = excluded.expires_at,
            installed_at = excluded.installed_at,
            installed_by = excluded.installed_by`
    ).run({
        key: licenseKey,
        tier: payload.tier,
        org: payload.org ?? null,
        email: payload.email ?? null,
        seats: payload.seats ?? null,
        issuedAt,
        expiresAt,
        userId: userId ?? null,
    })
}

export function clearStoredLicense() {
    db.prepare('DELETE FROM installed_license WHERE id = 1').run()
}
