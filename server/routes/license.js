import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getLicenseInfo } from '../middleware/require-tier.js'
import { validateLicenseKey } from '../lib/license.js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicKeyPath = join(__dirname, '..', '..', 'keys', 'public.pem')
const PUBLIC_KEY = existsSync(publicKeyPath)
  ? readFileSync(publicKeyPath, 'utf-8')
  : null

const router = Router()

// GET /api/v1/license — current license info
router.get('/', requireAuth, (req, res) => {
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
    source: 'license_key',
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
router.post('/validate', async (req, res) => {
  const { key } = req.body
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid key' })
  }

  if (!PUBLIC_KEY) {
    return res.status(500).json({ error: 'License validation not configured (missing public key)' })
  }

  const payload = await validateLicenseKey(key, PUBLIC_KEY)
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

export default router
