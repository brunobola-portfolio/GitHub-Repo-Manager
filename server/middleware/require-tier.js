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
import { getStoredLicense } from '../lib/license-store.js'
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

// Cache validated license to avoid re-parsing on every request.
// `cachedLicenseSource` distinguishes 'env' (LICENSE_KEY in .env, requires
// restart to change) from 'db' (installed_license table, hot-reloadable via
// refreshLicenseCache()).
let cachedLicenseTier = null
let cachedLicensePayload = null
let cachedLicenseSource = null

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

  if (cachedLicenseTier && PUBLIC_KEY) {
    if (cachedLicensePayload && isLicenseExpired(cachedLicensePayload)) {
      // Cache the exp before we null the payload so the log line shows the
      // real expiration timestamp instead of `undefined` (caught in review).
      const expiredAt = cachedLicensePayload.exp
      cachedLicenseTier = null
      cachedLicensePayload = null
      cachedLicenseSource = null
      logger.warn({ exp: expiredAt }, 'Cached license expired — downgrading to free')
      return 'free'
    }
    return cachedLicenseTier
  }

  return 'free'
}

export function getLicenseInfo() {
  return cachedLicensePayload
}

export function getLicenseSource() {
  return cachedLicenseSource
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

/**
 * Validate a key and update the in-memory cache. Used at startup AND after
 * a hot install/uninstall so subsequent requests see the new tier without
 * a server restart.
 *
 * Source precedence: env LICENSE_KEY beats DB-stored license. Operators
 * can pin a deployment to a specific license via env and the in-app
 * activation flow won't override it.
 */
export async function refreshLicenseCache() {
  if (!PUBLIC_KEY) {
    cachedLicenseTier = null
    cachedLicensePayload = null
    cachedLicenseSource = null
    return null
  }

  const envKey = config.licenseKey || null
  if (envKey) {
    const payload = await validateLicenseKey(envKey, singleKeyResolver(PUBLIC_KEY))
    if (payload && payload.tier && !isLicenseExpired(payload)) {
      cachedLicenseTier = payload.tier
      cachedLicensePayload = payload
      cachedLicenseSource = 'env'
      return payload
    }
    logger.warn('LICENSE_KEY env var is set but invalid or expired.')
    cachedLicenseTier = null
    cachedLicensePayload = null
    cachedLicenseSource = null
    return null
  }

  // Fall back to DB-installed license (hot activation).
  const stored = getStoredLicense()
  if (stored?.licenseKey) {
    const payload = await validateLicenseKey(stored.licenseKey, singleKeyResolver(PUBLIC_KEY))
    if (payload && payload.tier && !isLicenseExpired(payload)) {
      cachedLicenseTier = payload.tier
      cachedLicensePayload = payload
      cachedLicenseSource = 'db'
      return payload
    }
    logger.warn('Stored license is invalid or expired — ignoring.')
  }

  cachedLicenseTier = null
  cachedLicensePayload = null
  cachedLicenseSource = null
  return null
}

// Warm the license cache at startup. Test envs skip the implicit boot
// (NODE_ENV === 'test') so unit tests can call refreshLicenseCache()
// explicitly with a controlled DB state.
if (process.env.NODE_ENV !== 'test') {
  refreshLicenseCache().then((payload) => {
    if (payload) {
      logger.info(
        { tier: payload.tier, org: payload.org || 'N/A', source: cachedLicenseSource,
          expires: payload.exp ? new Date(payload.exp * 1000).toISOString().split('T')[0] : 'never' },
        'License validated'
      )
    }
  }).catch(() => {})
}
