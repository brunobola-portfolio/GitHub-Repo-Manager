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
import { tierRequiredPayload } from '../lib/usage-meter.js'

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
//
// LICENSE_CACHE_TTL_MS bounds how long a stale cached payload is honoured
// when the DB-backed license is revoked or rotated without a restart. After
// the TTL elapses the next `getUserTier()` call triggers a background
// `refreshLicenseCache()`; the current request still serves the cached
// value (so a slow DB doesn't stall every authenticated route) but
// subsequent requests see the fresh state.
let cachedLicenseTier = null
let cachedLicensePayload = null
let cachedLicenseSource = null
let cachedLicenseRefreshedAt = 0
let licenseRefreshInFlight = null
const LICENSE_CACHE_TTL_MS = 5 * 60_000

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

function maybeKickLicenseRefresh() {
  if (cachedLicenseSource !== 'db') return
  if (Date.now() - cachedLicenseRefreshedAt < LICENSE_CACHE_TTL_MS) return
  if (licenseRefreshInFlight) return
  licenseRefreshInFlight = refreshLicenseCache()
    .catch((err) => logger.warn({ err: err?.message }, 'Background license refresh failed'))
    .finally(() => { licenseRefreshInFlight = null })
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
    // Best-effort revalidation for DB-sourced licences: a hot-revoked key
    // would otherwise be honoured indefinitely. The refresh runs in the
    // background — the current request still serves the cached tier.
    maybeKickLicenseRefresh()
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

export function requireTier(minTier, feature = null) {
  const minOrder = getTierOrder(minTier)
  return (req, res, next) => {
    const userTier = getUserTier(req.session?.userId || req.tenantId)
    req.userTier = userTier
    if (getTierOrder(userTier) >= minOrder) return next()
    // Canonical 403 payload — every tier-gated route now uses the same shape
    // so QuotaExceededState on the frontend can render uniformly.
    const featureName = feature || req.baseUrl + req.path
    return res.status(403).json(tierRequiredPayload(userTier, minTier, featureName))
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
    cachedLicenseRefreshedAt = Date.now()
    return null
  }

  const envKey = config.licenseKey || null
  if (envKey) {
    const payload = await validateLicenseKey(envKey, singleKeyResolver(PUBLIC_KEY))
    if (payload && payload.tier && !isLicenseExpired(payload)) {
      cachedLicenseTier = payload.tier
      cachedLicensePayload = payload
      cachedLicenseSource = 'env'
      cachedLicenseRefreshedAt = Date.now()
      return payload
    }
    logger.warn('LICENSE_KEY env var is set but invalid or expired.')
    cachedLicenseTier = null
    cachedLicensePayload = null
    cachedLicenseSource = null
    cachedLicenseRefreshedAt = Date.now()
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
      cachedLicenseRefreshedAt = Date.now()
      return payload
    }
    logger.warn('Stored license is invalid or expired — ignoring.')
  }

  cachedLicenseTier = null
  cachedLicensePayload = null
  cachedLicenseSource = null
  cachedLicenseRefreshedAt = Date.now()
  return null
}

// NOTE: the startup license-cache warm used to fire here, at module load —
// but ESM import evaluation runs before server/index.js's own body (which
// calls initDB()), so on a genuinely empty database this queried
// `installed_license` before initDB() had created it. That was invisible in
// practice (every long-lived dev/prod DB already has the full schema from
// prior boots) until the Windows package made a truly fresh DB the NORMAL
// first-launch case. The warm call now lives in server/index.js, fired
// immediately after initDB() — see the comment there.
