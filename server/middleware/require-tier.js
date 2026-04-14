// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { getTierOrder } from '../lib/feature-flags.js'
import { validateLicenseKey, isLicenseExpired } from '../lib/license.js'
import { config } from '../config.js'
import logger from '../lib/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load public key for license validation (once at startup)
const publicKeyPath = join(__dirname, '..', '..', 'keys', 'public.pem')
const PUBLIC_KEY = existsSync(publicKeyPath)
  ? readFileSync(publicKeyPath, 'utf-8')
  : null

// A Phase 1 stub resolver that ignores kid and returns the single configured
// public key. Phase 2+ replaces this with a real multi-key lookup.
const singleKeyResolver = (pem) => () => pem

// Cache validated license to avoid re-parsing on every request
let cachedLicenseTier = null
let cachedLicenseKey = null
let cachedLicensePayload = null

/**
 * Resolve the effective tier from Stripe subscription and/or license key.
 * Exported for testing.
 *
 * `publicKey` may be either a PEM string (legacy single-key) or a
 * `resolveKeyByKid` function (Phase 1 single-key stub, Phase 2+ multi-key map).
 */
export async function resolveEffectiveTier(stripeTier, licenseKey, publicKey) {
  if (stripeTier && stripeTier !== 'free') return stripeTier
  if (licenseKey && publicKey) {
    // Wrap a static key as a resolver that ignores kid (Phase 1 stub).
    // When Phase 2 ships multi-key support, callers pass a real lookup fn.
    const resolver = typeof publicKey === 'function' ? publicKey : singleKeyResolver(publicKey)
    const payload = await validateLicenseKey(licenseKey, resolver)
    if (payload && payload.tier) return payload.tier
  }
  return 'free'
}

function getStripeTier(userId) {
  if (!userId) return null
  const row = db.prepare(
    'SELECT tier FROM user_subscriptions WHERE user_id = ? AND status = ?'
  ).get(userId, 'active')
  return row?.tier || null
}

export function getUserTier(userId) {
  const stripeTier = getStripeTier(userId)
  if (stripeTier && stripeTier !== 'free') return stripeTier

  const envKey = config.licenseKey || null
  if (envKey && PUBLIC_KEY) {
    // Use cache if warm AND the cached payload hasn't expired since startup.
    // Without this expiry recheck, a license that expires while the process
    // is running would keep unlocking gated features until the next restart.
    if (cachedLicenseTier && envKey === cachedLicenseKey) {
      if (cachedLicensePayload && isLicenseExpired(cachedLicensePayload)) {
        // Cache the exp before we null the payload so the log line shows the
        // real expiration timestamp instead of `undefined` (caught in review).
        const expiredAt = cachedLicensePayload.exp
        cachedLicenseTier = null
        cachedLicensePayload = null
        logger.warn({ exp: expiredAt }, 'Cached license expired — downgrading to free')
        return 'free'
      }
      return cachedLicenseTier
    }
    // Cold start: return free until initLicenseCache() populates the cache
    // Avoids using unverified JWT parsing as a fallback
    return 'free'
  }

  return 'free'
}

export function getLicenseInfo() {
  return cachedLicensePayload
}

export function requireTier(minTier) {
  const minOrder = getTierOrder(minTier)
  return (req, res, next) => {
    const userTier = getUserTier(req.session?.userId || req.tenantId)
    req.userTier = userTier
    if (getTierOrder(userTier) >= minOrder) return next()
    return res.status(403).json({
      error: 'upgrade_required',
      message: `This feature requires the ${minTier} plan`,
      currentTier: userTier,
      requiredTier: minTier,
    })
  }
}

export function attachTier(req, res, next) {
  req.userTier = getUserTier(req.session?.userId || req.tenantId)
  next()
}

// Warm the license cache at startup (async)
async function initLicenseCache() {
  const envKey = config.licenseKey || null
  if (envKey && PUBLIC_KEY) {
    const payload = await validateLicenseKey(envKey, singleKeyResolver(PUBLIC_KEY))
    if (payload && payload.tier) {
      cachedLicenseKey = envKey
      cachedLicenseTier = payload.tier
      cachedLicensePayload = payload
      logger.info({ tier: payload.tier, org: payload.org || 'N/A', expires: new Date(payload.exp * 1000).toISOString().split('T')[0] }, 'License validated')
    } else {
      logger.warn('LICENSE_KEY is set but invalid or expired.')
    }
  }
}

initLicenseCache().catch(() => {})
