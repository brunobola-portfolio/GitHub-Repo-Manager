import crypto from 'crypto'
import logger from './logger.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const SALT_LENGTH = 16
const ITERATIONS = 100000
const KEY_LENGTH = 32

// Track whether we've already logged the fallback warning so we don't spam the
// log on every encryption/decryption call.
let fallbackWarned = false

function deriveKey(salt) {
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
  const context = Buffer.from('grm-credential-v1')
  const material = Buffer.concat([context, Buffer.from(secret)])
  return crypto.pbkdf2Sync(material, salt, ITERATIONS, KEY_LENGTH, 'sha256')
}

export function encryptCredentials(credentials) {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = deriveKey(salt)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const plaintext = JSON.stringify(credentials)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([salt, iv, tag, encrypted]).toString('hex')
}

export function decryptCredentials(encoded) {
  const buf = Buffer.from(encoded, 'hex')
  const salt = buf.subarray(0, SALT_LENGTH)
  const key = deriveKey(salt)
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
