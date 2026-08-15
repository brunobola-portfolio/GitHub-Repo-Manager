// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.

import { SignJWT, jwtVerify, generateKeyPair as joseGenerateKeyPair, exportPKCS8, exportSPKI, importSPKI, importPKCS8 } from 'jose'
import { randomUUID } from 'crypto'

export const LICENSE_PREFIX = 'grm_lic_'
const ALG = 'EdDSA'

export async function generateKeyPair() {
  const { privateKey, publicKey } = await joseGenerateKeyPair(ALG, { crv: 'Ed25519', extractable: true })
  return {
    privateKey: await exportPKCS8(privateKey),
    publicKey: await exportSPKI(publicKey),
  }
}

/**
 * Add a whole number of calendar months to a unix timestamp, returning the
 * resulting unix timestamp (seconds). Calendar-month arithmetic — not a flat
 * `months * 30 days` multiplication — because a 12-month key must cover a
 * real Stripe yearly billing cycle (365 or 366 days, never 360), and a
 * monthly key must not go dead a day early in 31-day months.
 *
 * @param {number} unixSeconds
 * @param {number} months
 * @returns {number}
 */
export function addCalendarMonths(unixSeconds, months) {
  const d = new Date(unixSeconds * 1000)
  d.setUTCMonth(d.getUTCMonth() + months)
  return Math.floor(d.getTime() / 1000)
}

export async function generateLicenseKey(opts, privateKeyPem) {
  const { org, email, tier, seats, months, features, kid } = opts
  const lid = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const exp = months > 0
    ? addCalendarMonths(now, months)
    : now - 1

  const payload = { lid, org, email, tier, seats }
  if (features && features.length > 0) payload.features = features

  const header = { alg: ALG, typ: 'JWT' }
  if (kid) header.kid = kid

  const key = await importPKCS8(privateKeyPem, ALG)
  const jwt = await new SignJWT(payload)
    .setProtectedHeader(header)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key)

  return LICENSE_PREFIX + jwt
}

// ---------------------------------------------------------------------------
// Revocation list
// ---------------------------------------------------------------------------
//
// generateLicenseKey() has always minted a `lid` into every key; until now
// nothing read it, so a leaked or refunded key was valid until `exp` with no
// kill switch. The list is the `revoked_licenses` table (migration 032).
//
// SEMANTICS — the check is LOCAL ONLY. Verification never touches the network:
//   • Hosted / self-hosted with a reachable DB: an admin revokes through
//     POST /api/v1/license/revocations and it takes effect immediately (the
//     route refreshes require-tier's cache), and permanently (the row survives
//     restarts — the list, not the process cache, is the source of truth).
//   • Air-gapped install: a revocation is honoured as soon as the row reaches
//     that machine, and never before. Nothing else is physically possible — a
//     vendor cannot reach a box that has no network — and the alternative
//     designs are worse: a signed CRL the install must fetch turns "offline"
//     into "unlicensed", and a fail-closed "cannot reach the CRL" check would
//     brick every offline customer the moment their link drops. For an
//     unreachable install the only remote kill switch remains a short `exp`,
//     which is why Stripe-issued keys are minted per billing period.
//   • No list bound at all (offline minting tools, `scripts/generate-license.js`)
//     means nothing is revoked, not "everything fails".
//
// This module stays import-time DB-free for exactly that last reason: the
// minting scripts import it to sign keys and must never open — let alone create
// — an install's manager.db. server/db.js binds the handle instead.
let revocationDb = null
let revocationTablePresent = false
let revokedLookupStmt = null

const REVOCATION_COLUMNS = 'lid, reason, revoked_at, revoked_by, org, tier, expires_at'

/**
 * Point license verification at the database holding `revoked_licenses`.
 * Called once by server/db.js; tests bind their own in-memory handle.
 *
 * @param {import('better-sqlite3').Database | null} db
 */
export function bindLicenseRevocationStore(db) {
  revocationDb = db || null
  revocationTablePresent = false
  revokedLookupStmt = null
}

/**
 * Look up one license id in the revocation list.
 *
 * @param {string | undefined} lid
 * @returns {{lid: string, reason: string, revoked_at: string, revoked_by: number|null,
 *            org: string|null, tier: string|null, expires_at: string|null} | null}
 */
export function getLicenseRevocation(lid) {
  if (!lid || typeof lid !== 'string' || !revocationDb) return null
  try {
    if (!revocationTablePresent) {
      // db.js binds at module load, which is before initDB() has created the
      // table on a genuinely fresh database. Only the positive result is
      // memoized so the very next call after initDB() starts working.
      const row = revocationDb.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='revoked_licenses' LIMIT 1`
      ).get()
      if (!row) return null
      revocationTablePresent = true
    }
    if (!revokedLookupStmt) {
      revokedLookupStmt = revocationDb.prepare(
        `SELECT ${REVOCATION_COLUMNS} FROM revoked_licenses WHERE lid = ?`
      )
    }
    return revokedLookupStmt.get(lid) || null
  } catch {
    return null
  }
}

/** Verification outcomes. `revoked` is deliberately distinct from `invalid`. */
export const LICENSE_INVALID = 'invalid'
export const LICENSE_EXPIRED = 'expired'
export const LICENSE_REVOKED = 'revoked'

/**
 * Verify a license key, reporting WHY it failed.
 *
 * @param {string} licenseKey - The full license key (with grm_lic_ prefix)
 * @param {string | ((kid: string | undefined) => string | null | Promise<string | null>)} publicKeyOrResolver -
 *   Either a static public key PEM string (legacy single-key callers) or a
 *   lookup function that receives the JWT's `kid` header and returns the
 *   matching public key PEM (or null if unknown). Resolvers may be sync
 *   or async — the result is awaited.
 * @returns {Promise<{ok: true, payload: object}
 *                 | {ok: false, reason: string, payload?: object, revocation?: object}>}
 */
export async function verifyLicenseKey(licenseKey, publicKeyOrResolver) {
  let payload
  try {
    if (!licenseKey || !licenseKey.startsWith(LICENSE_PREFIX)) {
      return { ok: false, reason: LICENSE_INVALID }
    }
    const jwt = licenseKey.slice(LICENSE_PREFIX.length)

    // If caller passed a function, resolve the public key by kid from the JWT header.
    // Otherwise treat the second arg as a static PEM string (backward compat).
    let publicKeyPem
    if (typeof publicKeyOrResolver === 'function') {
      const headerB64 = jwt.split('.')[0]
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
      publicKeyPem = await publicKeyOrResolver(header.kid)
      if (!publicKeyPem) return { ok: false, reason: LICENSE_INVALID }
    } else {
      publicKeyPem = publicKeyOrResolver
    }

    const key = await importSPKI(publicKeyPem, ALG)
    const verified = await jwtVerify(jwt, key, { algorithms: ['EdDSA'] })
    payload = verified.payload
  } catch (err) {
    return {
      ok: false,
      reason: err?.code === 'ERR_JWT_EXPIRED' ? LICENSE_EXPIRED : LICENSE_INVALID,
    }
  }

  // Revocation is consulted only AFTER the signature verifies, so an unsigned
  // `lid` can never probe the list, and so a forged key still reports
  // `invalid` rather than leaking whether that id was ever issued.
  const revocation = getLicenseRevocation(payload.lid)
  if (revocation) {
    return { ok: false, reason: LICENSE_REVOKED, payload, revocation }
  }

  return { ok: true, payload }
}

/**
 * Validate a license key and return the parsed payload, or null on failure.
 *
 * Back-compatible wrapper around verifyLicenseKey — a revoked key now returns
 * null here too, which is what makes every existing caller
 * (middleware/require-tier.js) fail closed with no change.
 *
 * @param {string} licenseKey - The full license key (with grm_lic_ prefix)
 * @param {string | ((kid: string | undefined) => string | null | Promise<string | null>)} publicKeyOrResolver
 * @returns {Promise<object | null>}
 */
export async function validateLicenseKey(licenseKey, publicKeyOrResolver) {
  const result = await verifyLicenseKey(licenseKey, publicKeyOrResolver)
  return result.ok ? result.payload : null
}

/**
 * Add a license id to the revocation list (idempotent — re-revoking updates the
 * reason and timestamp rather than failing on the PRIMARY KEY).
 *
 * Callers pass the db handle explicitly so this module keeps no import-time DB
 * dependency; the SQL lives here so the table's contract stays in one file.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{lid: string, reason: string, revokedBy?: number|null, org?: string|null,
 *          tier?: string|null, expiresAt?: string|null}} entry
 */
export function revokeLicense(db, { lid, reason, revokedBy = null, org = null, tier = null, expiresAt = null }) {
  db.prepare(
    `INSERT INTO revoked_licenses (lid, reason, revoked_at, revoked_by, org, tier, expires_at)
     VALUES (@lid, @reason, datetime('now'), @revokedBy, @org, @tier, @expiresAt)
     ON CONFLICT(lid) DO UPDATE SET
        reason     = excluded.reason,
        revoked_at = excluded.revoked_at,
        revoked_by = excluded.revoked_by,
        org        = COALESCE(excluded.org, revoked_licenses.org),
        tier       = COALESCE(excluded.tier, revoked_licenses.tier),
        expires_at = COALESCE(excluded.expires_at, revoked_licenses.expires_at)`
  ).run({ lid, reason, revokedBy, org, tier, expiresAt })
}

/**
 * Remove a license id from the revocation list. Exists so an operator can undo
 * a mistaken revocation without hand-editing SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} lid
 * @returns {boolean} true when a row was actually removed
 */
export function unrevokeLicense(db, lid) {
  const info = db.prepare('DELETE FROM revoked_licenses WHERE lid = ?').run(lid)
  return info.changes > 0
}

/**
 * List the revocation entries, most recent first.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} [limit=200]
 */
export function listRevokedLicenses(db, limit = 200) {
  return db.prepare(
    `SELECT ${REVOCATION_COLUMNS} FROM revoked_licenses
      ORDER BY revoked_at DESC, lid ASC LIMIT ?`
  ).all(limit)
}

// Reject license payloads whose `exp` is more than 10 years in the future.
// A malformed or forged token with `exp: 9999999999` (year 2286) should be
// treated as expired (defence in depth — `jwtVerify` would normally catch
// signature tampering, but a leaked signing key would let an attacker mint
// effectively-perpetual licenses).
const MAX_EXP_OFFSET_SECONDS = 10 * 365 * 24 * 60 * 60

export function isLicenseExpired(payload) {
  if (!payload || !payload.exp) return true
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp > now + MAX_EXP_OFFSET_SECONDS) return true
  return now > payload.exp
}

export function parseLicenseKey(licenseKey) {
  try {
    if (!licenseKey || !licenseKey.startsWith(LICENSE_PREFIX)) return null
    const jwt = licenseKey.slice(LICENSE_PREFIX.length)
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    return payload
  } catch {
    return null
  }
}
