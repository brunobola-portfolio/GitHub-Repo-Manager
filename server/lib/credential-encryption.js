import crypto from 'crypto'
import logger from './logger.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const SALT_LENGTH = 16
const KEY_LENGTH = 32

// Versioned KDF parameters. v1 blobs (no prefix) keep decrypting with the
// legacy parameters; everything newly encrypted uses v2 (OWASP-aligned
// PBKDF2-SHA512 @ 210k). Bumping params again = add v3, never mutate v1/v2.
const V2_PREFIX = 'v2:'
const KDF = {
  v1: { iterations: 100000, digest: 'sha256' },
  v2: { iterations: 210000, digest: 'sha512' },
}

// Derived-key cache: the KDF is the expensive part (~100ms+) and the same
// salt recurs on every decrypt of a given credential — e.g. each migration
// request that uses a saved PAT. Keyed by version+salt; bounded.
const keyCache = new Map()
const KEY_CACHE_MAX = 256

// Track whether we've already logged the fallback warning so we don't spam the
// log on every encryption/decryption call.
let fallbackWarned = false

function resolveSecret() {
  const primary = process.env.CREDENTIAL_ENCRYPTION_KEY
  const fallback = process.env.SESSION_SECRET
  const nodeEnv = process.env.NODE_ENV

  let secret = primary
  if (!secret) {
    // In production, CREDENTIAL_ENCRYPTION_KEY is mandatory — verified at
    // startup by verifySecretsAtStartup(). This path should never execute
    // in prod, but guard defensively in case a process bypasses the check.
    if (nodeEnv === 'production') {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY must be set in production')
    }
    if (fallback) {
      if (!fallbackWarned) {
        logger.warn(
          '[credential-encryption] CREDENTIAL_ENCRYPTION_KEY not set — ' +
          'falling back to SESSION_SECRET (dev/test only). Set a dedicated ' +
          'CREDENTIAL_ENCRYPTION_KEY before deploying to production.'
        )
        fallbackWarned = true
      }
      secret = fallback
    }
  }
  if (!secret) throw new Error('SESSION_SECRET or CREDENTIAL_ENCRYPTION_KEY not configured')
  return secret
}

function deriveKey(salt, version) {
  const { iterations, digest } = KDF[version]
  const secret = resolveSecret()
  const cacheKey = `${version}:${salt.toString('hex')}:${secret.length}`
  const hit = keyCache.get(cacheKey)
  if (hit) return hit
  // Keep the v1 KDF context string for both versions — the version byte
  // lives in the blob prefix, not the context.
  const context = Buffer.from('grm-credential-v1')
  const material = Buffer.concat([context, Buffer.from(secret)])
  const key = crypto.pbkdf2Sync(material, salt, iterations, KEY_LENGTH, digest)
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.clear()
  keyCache.set(cacheKey, key)
  return key
}

export function encryptCredentials(credentials) {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = deriveKey(salt, 'v2')
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const plaintext = JSON.stringify(credentials)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return V2_PREFIX + Buffer.concat([salt, iv, tag, encrypted]).toString('hex')
}

export function decryptCredentials(encoded) {
  const version = encoded.startsWith(V2_PREFIX) ? 'v2' : 'v1'
  const hex = version === 'v2' ? encoded.slice(V2_PREFIX.length) : encoded
  const buf = Buffer.from(hex, 'hex')
  const salt = buf.subarray(0, SALT_LENGTH)
  const key = deriveKey(salt, version)
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
  const encrypted = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}

export function isSchedulingEnabled() {
  return !!process.env.SESSION_SECRET
}
