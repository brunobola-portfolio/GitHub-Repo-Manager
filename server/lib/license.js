// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

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

/**
 * Validate a license key and return the parsed payload, or null on failure.
 *
 * @param {string} licenseKey - The full license key (with grm_lic_ prefix)
 * @param {string | ((kid: string | undefined) => string | null | Promise<string | null>)} publicKeyOrResolver -
 *   Either a static public key PEM string (legacy single-key callers) or a
 *   lookup function that receives the JWT's `kid` header and returns the
 *   matching public key PEM (or null if unknown). Resolvers may be sync
 *   or async — the result is awaited.
 * @returns {Promise<object | null>}
 */
export async function validateLicenseKey(licenseKey, publicKeyOrResolver) {
  try {
    if (!licenseKey || !licenseKey.startsWith(LICENSE_PREFIX)) return null
    const jwt = licenseKey.slice(LICENSE_PREFIX.length)

    // If caller passed a function, resolve the public key by kid from the JWT header.
    // Otherwise treat the second arg as a static PEM string (backward compat).
    let publicKeyPem
    if (typeof publicKeyOrResolver === 'function') {
      const headerB64 = jwt.split('.')[0]
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
      publicKeyPem = await publicKeyOrResolver(header.kid)
      if (!publicKeyPem) return null
    } else {
      publicKeyPem = publicKeyOrResolver
    }

    const key = await importSPKI(publicKeyPem, ALG)
    const { payload } = await jwtVerify(jwt, key, { algorithms: ['EdDSA'] })
    return payload
  } catch {
    return null
  }
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
