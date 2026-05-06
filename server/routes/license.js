// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  getLicenseInfo,
  getLicenseSource,
  refreshLicenseCache,
} from '../middleware/require-tier.js'
import { requireAuth } from '../middleware/auth.js'
import { requireAdmin } from '../middleware/require-admin.js'
import { validateLicenseKey } from '../lib/license.js'
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

  const payload = await validateLicenseKey(key, singleKeyResolver(PUBLIC_KEY))
  if (!payload) {
    return res.status(400).json({ valid: false, error: 'Invalid or expired license key' })
  }

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
//   • Bootstrap (no license stored, no LICENSE_KEY env): any authenticated
//     user may install. The installer is promoted to admin so they can
//     manage/replace/uninstall the license later. Solves the chicken-and-
//     egg of self-hosted setups where the first user has no admin yet.
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

  const isBootstrap = !getStoredLicense()
  if (!isBootstrap) {
    const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session?.userId)
    if (!userRow?.is_admin) {
      return res.status(403).json({
        error: 'admin_only',
        message: 'A license is already installed — replacing it requires admin.',
      })
    }
  }

  const payload = await validateLicenseKey(key, singleKeyResolver(PUBLIC_KEY))
  if (!payload) {
    return res.status(400).json({ valid: false, error: 'Invalid or expired license key' })
  }

  try {
    const userId = req.session?.userId ?? null
    setStoredLicense(key, payload, userId)

    // Bootstrap promotion: the first installer becomes admin so they can
    // later replace or uninstall the license without an out-of-band CLI.
    if (isBootstrap && userId) {
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
    logger.error({ err: err.message }, 'License install failed')
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

export default router
