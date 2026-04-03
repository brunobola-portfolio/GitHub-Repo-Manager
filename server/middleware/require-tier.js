import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { getTierOrder } from '../lib/feature-flags.js'
import { validateLicenseKey } from '../lib/license.js'
import { config } from '../config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load public key for license validation (once at startup)
const publicKeyPath = join(__dirname, '..', '..', 'keys', 'public.pem')
const PUBLIC_KEY = existsSync(publicKeyPath)
  ? readFileSync(publicKeyPath, 'utf-8')
  : null

// Cache validated license to avoid re-parsing on every request
let cachedLicenseTier = null
let cachedLicenseKey = null
let cachedLicensePayload = null

/**
 * Resolve the effective tier from Stripe subscription and/or license key.
 * Exported for testing.
 */
export async function resolveEffectiveTier(stripeTier, licenseKey, publicKey) {
  if (stripeTier && stripeTier !== 'free') return stripeTier
  if (licenseKey && publicKey) {
    const payload = await validateLicenseKey(licenseKey, publicKey)
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
    if (envKey === cachedLicenseKey && cachedLicenseTier) {
      return cachedLicenseTier
    }
    return cachedLicenseTier || 'free'
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
    const payload = await validateLicenseKey(envKey, PUBLIC_KEY)
    if (payload && payload.tier) {
      cachedLicenseKey = envKey
      cachedLicenseTier = payload.tier
      cachedLicensePayload = payload
      console.log(`License validated: ${payload.tier} tier (org: ${payload.org || 'N/A'}, expires: ${new Date(payload.exp * 1000).toISOString().split('T')[0]})`)
    } else {
      console.warn('LICENSE_KEY is set but invalid or expired.')
    }
  }
}

initLicenseCache().catch(() => {})
