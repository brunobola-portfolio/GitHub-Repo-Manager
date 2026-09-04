// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.

import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  getLicenseInfo,
  getLicenseSource,
  refreshLicenseCache,
} from '../middleware/require-tier.js'
import { requireAuth } from '../middleware/auth.js'
import { requireAdmin } from '../middleware/require-admin.js'
import {
  LICENSE_REVOKED,
  listRevokedLicenses,
  parseLicenseKey,
  revokeLicense,
  unrevokeLicense,
  verifyLicenseKey,
} from '../lib/license.js'
import {
  getStoredLicense,
  setStoredLicense,
  clearStoredLicense,
} from '../lib/license-store.js'
import { auditLog } from '../lib/audit.js'
import { config } from '../config.js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import logger from '../lib/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicKeyPath = join(__dirname, '..', '..', 'keys', 'public.pem')
const PUBLIC_KEY = existsSync(publicKeyPath)
  ? readFileSync(publicKeyPath, 'utf-8')
  : null

const singleKeyResolver = (pem) => () => pem

// Strict rate limit for unauthenticated validate endpoint
const validateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many validation requests. Try again in a minute.' },
})

// Looser limit for authenticated install — mirrors validate's 5/min so a
// hostile session can't spam JWT verification, but install is rare so this
// is generous for legitimate operators.
const installLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many install requests. Try again in a minute.' },
})

const router = Router()

// A revoked key gets its own status + machine-readable code so the UI can say
// "this key was killed, ask for a replacement" instead of the misleading
// "invalid or expired license key" — which sends the customer hunting for a
// typo that isn't there.
//
// The operator's free-text `reason` is NOT echoed here. /validate is
// unauthenticated and /install is open to any authenticated user during
// bootstrap, and that note routinely carries internal context ("chargeback",
// "employee offboarded"). Holders get the actionable facts — revoked, when,
// what to do; the note stays on the admin-only listing.
function revokedResponse(res, revocation) {
  return res.status(403).json({
    valid: false,
    error: 'license_revoked',
    revokedAt: revocation?.revoked_at ?? null,
    message: 'This license key has been revoked and can no longer be activated. '
      + 'Contact your vendor for a replacement key.',
  })
}

// GET /api/v1/license — current license info (public: server-level info, no user data)
router.get('/', (req, res) => {
  const info = getLicenseInfo()
  if (!info) {
    return res.json({
      active: false,
      source: 'none',
      tier: req.userTier || 'free',
    })
  }

  const activeUsers = db.prepare(
    "SELECT COUNT(*) as count FROM users WHERE last_login > datetime('now', '-30 days')"
  ).get()

  res.json({
    active: true,
    source: getLicenseSource() || 'license_key',
    tier: info.tier,
    org: info.org,
    email: info.email,
    seats: info.seats,
    seatsUsed: activeUsers?.count || 0,
    expiresAt: info.exp ? new Date(info.exp * 1000).toISOString() : null,
    issuedAt: info.iat ? new Date(info.iat * 1000).toISOString() : null,
  })
})

// POST /api/v1/license/validate — validate a key (for setup wizards)
router.post('/validate', validateLimiter, async (req, res) => {
  const { key } = req.body
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid key' })
  }

  if (!PUBLIC_KEY) {
    return res.status(500).json({ error: 'License validation not configured (missing public key)' })
  }

  const result = await verifyLicenseKey(key, singleKeyResolver(PUBLIC_KEY))
  if (!result.ok) {
    if (result.reason === LICENSE_REVOKED) return revokedResponse(res, result.revocation)
    return res.status(400).json({ valid: false, error: 'Invalid or expired license key' })
  }
  const payload = result.payload

  res.json({
    valid: true,
    tier: payload.tier,
    org: payload.org,
    seats: payload.seats,
    expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
  })
})

// POST /api/v1/license/install — hot-activate a license without restart.
//
// Gating model:
//   • Bootstrap (no license stored, no LICENSE_KEY env, no admin yet, and
//     exactly ONE account on the instance): that user may install, and is
//     promoted to admin so they can manage/replace/uninstall it later.
//     Solves the chicken-and-egg of a fresh self-hosted setup.
//   • Any other case: admin-only. Installing sets the tier for every account
//     on the instance, so on a shared deployment it is an operator action —
//     a multi-user instance with no admin bootstraps via `npm run admin:grant`,
//     which requires host access.
//   • Steady state (license already installed): admin-only. Replacing an
//     active license is an operator action.
//
// The env LICENSE_KEY (if set) always wins over the DB-stored license, so
// an operator can pin a deployment via env and disable UI activation by
// simply leaving LICENSE_KEY set.
router.post('/install', requireAuth, installLimiter, async (req, res) => {
  const { key } = req.body || {}
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid key' })
  }

  if (!PUBLIC_KEY) {
    return res.status(500).json({ error: 'License validation not configured (missing public key)' })
  }

  if (config.licenseKey) {
    // Don't silently overwrite an env-pinned license. Surface the conflict
    // so operators know their deployment-time configuration takes precedence.
    return res.status(409).json({
      error: 'env_license_set',
      message: 'LICENSE_KEY is set in environment — UI activation is disabled. Remove the env var or update it directly.',
    })
  }

  const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session?.userId)

  // Installing a licence sets the tier for EVERY user on the instance, and the
  // bootstrap branch also makes the caller a permanent admin. On a shared
  // deployment — the shipped docker-compose with a public FRONTEND_URL and
  // Stripe billing, where LICENSE_KEY is optional and no licence is stored —
  // that let any authenticated user with a valid key promote themselves.
  //
  // The chicken-and-egg this solves is a genuinely fresh single-user install,
  // so that is exactly what it is now scoped to. Multi-user instances with no
  // admin use the CLI (`npm run admin:grant`), which requires host access.
  const isBootstrap = !getStoredLicense()
  const adminExists = !!db.prepare('SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1').get()
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n ?? 0
  const bootstrapEligible = isBootstrap && !adminExists && userCount === 1

  if (!userRow?.is_admin && !bootstrapEligible) {
    if (isBootstrap && !adminExists) {
      return res.status(403).json({
        error: 'admin_required_multi_user',
        message: 'This instance has more than one account, so licence activation needs an admin. Grant one on the host with `npm run admin:grant`, then activate from that account.',
      })
    }
    return res.status(403).json({
      error: 'admin_only',
      message: isBootstrap
        ? 'Installing a licence sets the tier for every account on this instance — an admin has to do it.'
        : 'A license is already installed — replacing it requires admin.',
    })
  }

  const result = await verifyLicenseKey(key, singleKeyResolver(PUBLIC_KEY))
  if (!result.ok) {
    if (result.reason === LICENSE_REVOKED) {
      auditLog(req, 'license.install_rejected_revoked', 'license', result.payload?.lid ?? 'unknown', {
        org: result.payload?.org ?? null,
        tier: result.payload?.tier ?? null,
      })
      return revokedResponse(res, result.revocation)
    }
    return res.status(400).json({ valid: false, error: 'Invalid or expired license key' })
  }
  const payload = result.payload

  try {
    const userId = req.session?.userId ?? null
    setStoredLicense(key, payload, userId)

    // Bootstrap promotion: the first installer becomes admin so they can
    // later replace or uninstall the license without an out-of-band CLI.
    // Scoped to a genuinely fresh single-user instance — see the gate above.
    if (bootstrapEligible && userId) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(userId)
      auditLog(req, 'admin.bootstrap_grant', 'user', userId, {
        trigger: 'license.install',
      })
    }

    const refreshed = await refreshLicenseCache()
    auditLog(req, 'license.install', 'license', payload.org ?? 'global', {
      tier: payload.tier,
      org: payload.org ?? null,
      bootstrap: isBootstrap,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    })
    logger.info(
      { tier: payload.tier, org: payload.org || 'N/A', bootstrap: isBootstrap },
      'License installed via API'
    )

    res.json({
      ok: true,
      active: !!refreshed,
      bootstrap: isBootstrap,
      source: getLicenseSource() || 'db',
      tier: payload.tier,
      org: payload.org,
      email: payload.email,
      seats: payload.seats,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
    })
  } catch (err) {
    logger.error({ err }, 'License install failed')
    res.status(500).json({ error: 'Failed to install license' })
  }
})

// DELETE /api/v1/license/install — uninstall the DB-stored license. The
// env LICENSE_KEY (if set) is unaffected — this only clears the hot-install
// row.
router.delete('/install', requireAuth, requireAdmin, async (req, res) => {
  const before = getStoredLicense()
  clearStoredLicense()
  await refreshLicenseCache()
  auditLog(req, 'license.uninstall', 'license', before?.org ?? 'global', {
    tier: before?.tier ?? null,
    org: before?.org ?? null,
  })
  logger.info({ priorTier: before?.tier ?? 'none' }, 'License uninstalled via API')
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Revocation list — the license kill switch (migration 032)
// ---------------------------------------------------------------------------
//
// Admin-only and audited. Uninstalling a license (DELETE /install above) only
// clears THIS server's active license; revoking kills the key itself, so it
// stays dead through a reinstall, a restart, and a re-emailed copy.
//
// Scope note: this is a per-install list, which is the honest shape for a
// self-hostable product — every operator is the authority for their own
// deployment, and there is no phone-home. See the SEMANTICS block in
// lib/license.js for what that means for air-gapped installs.

const MAX_LID_LENGTH = 128
const MAX_REASON_LENGTH = 500

// GET /api/v1/license/revocations — the full list (admin only; the free-text
// reason is operator-internal and never leaves this endpoint)
router.get('/revocations', requireAuth, requireAdmin, (req, res) => {
  res.json({ revocations: listRevokedLicenses(db) })
})

// POST /api/v1/license/revocations — revoke a license id
//
// Accepts either `lid` directly or the full `key` it was minted into. The key
// is only PARSED, never verified: an operator must be able to revoke a key
// whose signing key has since been rotated away, or one this install could not
// validate in the first place. Nothing is trusted from the parse beyond the
// strings we store for display.
router.post('/revocations', requireAuth, requireAdmin, async (req, res) => {
  const { lid: rawLid, key, reason } = req.body || {}

  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return res.status(400).json({
      error: 'A revocation reason is required — it is the only record of why this key was killed.',
      code: 'reason_required',
    })
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return res.status(400).json({ error: `Reason must be at most ${MAX_REASON_LENGTH} characters.`, code: 'reason_too_long' })
  }

  const parsed = typeof key === 'string' && key ? parseLicenseKey(key) : null
  const lid = typeof rawLid === 'string' && rawLid.trim()
    ? rawLid.trim()
    : (typeof parsed?.lid === 'string' ? parsed.lid : null)

  if (!lid || lid.length > MAX_LID_LENGTH) {
    return res.status(400).json({
      error: 'Provide the license id (`lid`) or the full license `key` to revoke.',
      code: 'lid_required',
    })
  }

  try {
    revokeLicense(db, {
      lid,
      reason: reason.trim(),
      revokedBy: req.session?.userId ?? null,
      org: typeof parsed?.org === 'string' ? parsed.org : null,
      tier: typeof parsed?.tier === 'string' ? parsed.tier : null,
      expiresAt: typeof parsed?.exp === 'number' ? new Date(parsed.exp * 1000).toISOString() : null,
    })

    // Without this the in-process tier cache in require-tier.js would keep
    // serving the revoked license's tier for up to LICENSE_CACHE_TTL_MS (and
    // forever for an env-pinned LICENSE_KEY). A revocation that needs a restart
    // is not a revocation.
    const refreshed = await refreshLicenseCache()

    auditLog(req, 'license.revoke', 'license', lid, {
      reason: reason.trim(),
      org: parsed?.org ?? null,
      tier: parsed?.tier ?? null,
      activeLicenseAffected: !refreshed,
    })
    logger.warn({ lid, activeLicenseAffected: !refreshed }, 'License revoked via API')

    res.json({
      ok: true,
      lid,
      // True when this install's own active license was the one just killed —
      // the caller's tier has already dropped.
      activeLicenseAffected: !refreshed,
      activeTier: refreshed?.tier ?? null,
    })
  } catch (err) {
    logger.error({ err }, 'License revoke failed')
    res.status(500).json({ error: 'Failed to revoke license' })
  }
})

// DELETE /api/v1/license/revocations/:lid — undo a mistaken revocation
router.delete('/revocations/:lid', requireAuth, requireAdmin, async (req, res) => {
  const lid = String(req.params.lid || '').trim()
  if (!lid || lid.length > MAX_LID_LENGTH) {
    return res.status(400).json({ error: 'Provide the license id (`lid`) to remove from the revocation list.', code: 'lid_required' })
  }
  try {
    const removed = unrevokeLicense(db, lid)
    if (!removed) {
      return res.status(404).json({ error: 'That license id is not on the revocation list.', code: 'not_revoked' })
    }
    const refreshed = await refreshLicenseCache()
    auditLog(req, 'license.unrevoke', 'license', lid, {})
    logger.warn({ lid }, 'License revocation removed via API')
    res.json({ ok: true, lid, activeTier: refreshed?.tier ?? null })
  } catch (err) {
    logger.error({ err }, 'License unrevoke failed')
    res.status(500).json({ error: 'Failed to remove revocation' })
  }
})

export default router
