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

function resolvePrimarySecret() {
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

/**
 * Ordered list of secrets to try when decrypting: the active primary first,
 * then `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` if set. This enables zero-downtime
 * key rotation — set the new key as `CREDENTIAL_ENCRYPTION_KEY` and the old one
 * as `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`; existing blobs keep decrypting while
 * every new write (encryptCredentials always uses the primary) re-encrypts
 * under the new key. Once all stored secrets have been re-saved, drop the
 * previous key. Encryption ALWAYS uses the primary (index 0).
 */
function resolveSecrets() {
  const primary = resolvePrimarySecret()
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS
  return (previous && previous !== primary) ? [primary, previous] : [primary]
}

function deriveKey(salt, version, secret) {
  const { iterations, digest } = KDF[version]
  // Cache on a per-secret fingerprint (NOT secret length — two rotation keys
  // can share a length, which would collide and hand back the wrong key).
  const fingerprint = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16)
  const cacheKey = `${version}:${salt.toString('hex')}:${fingerprint}`
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
  const key = deriveKey(salt, 'v2', resolveSecrets()[0]) // always the primary
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
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
  const encrypted = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)

  // Try the primary key, then the previous key (rotation). A GCM auth failure
  // on the wrong key throws — fall through and try the next. Only when no
  // configured secret can authenticate the blob do we surface the error.
  let lastError
  for (const secret of resolveSecrets()) {
    try {
      const key = deriveKey(salt, version, secret)
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(tag)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
      return JSON.parse(decrypted.toString('utf8'))
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

export function isSchedulingEnabled() {
  return !!process.env.SESSION_SECRET
}

// ---------------------------------------------------------------------------
// Session-field helpers (used by lib/session-store.js + lib/session-token-lookup.js)
// ---------------------------------------------------------------------------
//
// Persisted sessions carry the GitHub OAuth token, so they go through the SAME
// blob format as every other stored credential — there is exactly one crypto
// path here. What they cannot afford is the KDF: deriveKey() only caches per
// (version, salt, secret) and encryptCredentials() mints a fresh random salt per
// blob, so an un-memoized session store would pay a full PBKDF2-SHA512 @210k
// derivation (~200ms on the reference machine) on every session write AND on the
// first read of every rewritten blob. Session reads run on every authenticated
// request, and the gh-outbox token scan sees up to 200 blobs at once.
//
// These wrappers memoize both directions, so a token costs one derivation per
// process and every later hit is a Map lookup:
//   - encrypt: a given plaintext always yields the byte-identical blob it was
//     first encrypted into, so re-saving an unchanged session does NOT rotate
//     the salt — which would otherwise force a fresh derivation on the next read.
//   - decrypt: an already-seen blob resolves without touching crypto, which also
//     keeps the store immune to deriveKey's 256-entry key cache being flushed by
//     unrelated credential traffic (Azure PATs, BYOK keys).
//
// The memo holds plaintext tokens in process memory. That is not a new exposure:
// express-session already keeps req.session.accessToken in memory for the life of
// every request. The threat this encryption closes is an at-rest read of
// manager.db, which ships in the same directory as the plaintext .env. Reusing
// one ciphertext per token also means two live sessions of the same user store
// identical blobs — no leak either, since `userId` deliberately stays in
// cleartext in the same row so the gh-outbox scan can index on it.
//
// Rotation caveat: a process that has already memoized a token keeps writing the
// blob encrypted under the key that was primary at memo time. Rotation is an env
// change and therefore a restart, after which the memo starts empty and every
// write lands on the new primary.
const SESSION_FIELD_MEMO_MAX = 1000
const sessionEncryptMemo = new Map()
const sessionDecryptMemo = new Map()

function rememberSessionField(plaintext, blob) {
  // Clear-on-full (same bounded-cache idiom as keyCache above): an LRU would
  // buy nothing here because every entry is equally likely to be re-read.
  if (sessionEncryptMemo.size >= SESSION_FIELD_MEMO_MAX) sessionEncryptMemo.clear()
  if (sessionDecryptMemo.size >= SESSION_FIELD_MEMO_MAX) sessionDecryptMemo.clear()
  sessionEncryptMemo.set(plaintext, blob)
  sessionDecryptMemo.set(blob, plaintext)
}

/**
 * Encrypt a single session field (the GitHub OAuth token).
 * @param {string} value
 * @returns {string} versioned ciphertext blob
 */
export function encryptSessionField(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('encryptSessionField requires a non-empty string')
  }
  const hit = sessionEncryptMemo.get(value)
  if (hit !== undefined) return hit
  const blob = encryptCredentials(value)
  rememberSessionField(value, blob)
  return blob
}

/**
 * Decrypt a session field produced by encryptSessionField.
 * @param {string} blob
 * @returns {string} the plaintext value
 */
export function decryptSessionField(blob) {
  const hit = sessionDecryptMemo.get(blob)
  if (hit !== undefined) return hit
  const value = decryptCredentials(blob)
  // decryptCredentials JSON.parses whatever was stored; anything but a string
  // means the blob was not written by encryptSessionField and must not be
  // handed back as a token.
  if (typeof value !== 'string') {
    throw new Error('session field did not decrypt to a string')
  }
  rememberSessionField(value, blob)
  return value
}

/**
 * Drop the session-field memo. Needed when the encryption key changes inside a
 * live process — which in practice only happens in tests, since rotating
 * CREDENTIAL_ENCRYPTION_KEY is an env change and therefore a restart.
 */
export function resetSessionFieldCache() {
  sessionEncryptMemo.clear()
  sessionDecryptMemo.clear()
}
