// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.

/**
 * License minting primitives. Lives under scripts/lib/ (not server/lib/)
 * because this module runs in GitHub Action VMs and future Phase 2 Node
 * contexts — it never loads as part of the running Express server.
 *
 * See: docs/specs/2026-04-11-license-mint-automation-design.md
 */

import { generateLicenseKey, validateLicenseKey } from '../../server/lib/license.js'
import { createHash } from 'node:crypto'

/** Base class so `instanceof Error` + step-level matching both work. */
class MinterError extends Error {
  constructor(message, step) {
    super(message)
    this.name = this.constructor.name
    this.step = step
  }
}

export class InputValidationError extends MinterError {
  constructor(message) { super(message, 'validate') }
}

export class MintError extends MinterError {
  constructor(message) { super(message, 'mint') }
}

export class DeliveryError extends MinterError {
  constructor(message, { lid } = {}) {
    super(message, 'deliver')
    this.lid = lid
  }
}

export class AuditWriteError extends MinterError {
  constructor(message, { lastSha } = {}) {
    super(message, 'audit')
    this.lastSha = lastSha
  }
}

const TIERS = new Set(['pro', 'enterprise'])
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const ORG_MAX = 200
const EMAIL_MAX = 254
const NOTES_MAX = 500
const SEATS_MIN = 1
const SEATS_MAX = 10000
const MONTHS_MIN = 1
const MONTHS_MAX = 24

function toPositiveInt(value, label, min, max) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new InputValidationError(`${label} must be an integer between ${min} and ${max}`)
  }
  return n
}

/**
 * Validate and normalize workflow inputs.
 *
 * Accepts string values (as produced by GitHub Actions workflow_dispatch
 * inputs, which are always strings) and returns numeric types where
 * appropriate.
 *
 * Throws InputValidationError on any failure. Runs before any crypto.
 */
export function validateInput(raw) {
  const tier = typeof raw.tier === 'string' ? raw.tier.trim() : ''
  if (!TIERS.has(tier)) {
    throw new InputValidationError('tier must be "pro" or "enterprise"')
  }

  const org = typeof raw.org === 'string' ? raw.org.trim() : ''
  if (!org) throw new InputValidationError('org is required')
  if (org.length > ORG_MAX) throw new InputValidationError(`org must be ≤ ${ORG_MAX} characters`)

  const email = typeof raw.email === 'string' ? raw.email.trim() : ''
  if (!email) throw new InputValidationError('email is required')
  if (email.length > EMAIL_MAX) throw new InputValidationError(`email must be ≤ ${EMAIL_MAX} characters`)
  if (!EMAIL_REGEX.test(email)) throw new InputValidationError('email is not a valid address')

  const seats = toPositiveInt(raw.seats ?? '1', 'seats', SEATS_MIN, SEATS_MAX)
  const months = toPositiveInt(raw.months ?? '12', 'months', MONTHS_MIN, MONTHS_MAX)

  const notes = typeof raw.notes === 'string' ? raw.notes : ''
  if (notes.length > NOTES_MAX) throw new InputValidationError(`notes must be ≤ ${NOTES_MAX} characters`)

  return { tier, org, email, seats, months, notes }
}

/**
 * Compute a short fingerprint of a public key PEM for cross-referencing
 * audit entries with the signing keypair. Used for "which key signed this?"
 * lookups after future key rotation.
 *
 * Normalizes CRLF → LF before hashing so the fingerprint is stable across
 * OSes (Windows checkouts would otherwise produce a different hash than
 * Linux runners for the byte-identical public key).
 */
function fingerprintPublicKey(publicKeyPem) {
  const normalized = publicKeyPem.replace(/\r\n/g, '\n')
  const hash = createHash('sha256').update(normalized).digest('hex')
  return 'SHA256:' + hash.slice(0, 32)
}

/**
 * Mint a license key from validated input.
 *
 * Contract:
 *  - On success, emits `::add-mask::<key>` to stdout as the FIRST action
 *    after signing, so GitHub Actions redacts the key in every subsequent
 *    log line (including exception stack traces).
 *  - In dry-run mode, returns { key: null, ... } — the key string is never
 *    populated, so there is nothing to leak.
 *  - Throws MintError wrapping any underlying crypto error.
 */
export async function mintLicense(validatedInput, options) {
  const { privateKeyPem, publicKeyPem, kid, dryRun } = options
  if (!privateKeyPem) throw new MintError('privateKeyPem is required')
  if (!publicKeyPem) throw new MintError('publicKeyPem is required')
  if (!kid) throw new MintError('kid is required')

  const fingerprint = fingerprintPublicKey(publicKeyPem)
  let key
  let payload
  try {
    key = await generateLicenseKey({ ...validatedInput, kid }, privateKeyPem)
    // Round-trip validation to extract the exact payload (with lid + timestamps)
    // for the audit log. Also verifies the just-minted key is well-formed.
    payload = await validateLicenseKey(key, publicKeyPem)
    if (!payload) throw new Error('minted key failed round-trip validation')
  } catch (e) {
    throw new MintError(`mint failed: ${e.message}`)
  }

  if (dryRun) {
    // Do not populate `key`, do not emit ::add-mask::. Nothing to leak.
    return { key: null, payload, fingerprint, kid }
  }

  // FIRST action after signing — mask the key in GitHub Actions logs.
  // This is defense-in-depth with the YAML-level masking in the workflow.
  process.stdout.write(`::add-mask::${key}\n`)

  return { key, payload, fingerprint, kid }
}

/**
 * Format the license payload into a plaintext email body.
 * Text-only to eliminate stored-XSS risk from attacker-controlled `notes`
 * reaching customer email clients that render HTML.
 */
function formatEmailBody({ key, payload }) {
  const tierLabel = payload.tier === 'enterprise' ? 'Enterprise' : 'Pro'
  const issued = new Date(payload.iat * 1000).toISOString().slice(0, 10)
  const expires = new Date(payload.exp * 1000).toISOString().slice(0, 10)
  return [
    'Hi,',
    '',
    'Your license for GitHub Repo Manager is ready.',
    '',
    'License Key:',
    key,
    '',
    'Details:',
    `  Tier:         ${tierLabel}`,
    `  Organization: ${payload.org}`,
    `  Seats:        ${payload.seats}`,
    `  Issued:       ${issued}`,
    `  Expires:      ${expires}`,
    '',
    'To activate, add this line to your .env file:',
    '',
    `  LICENSE_KEY=${key}`,
    '',
    'Then restart the server. To verify activation, check the server logs for:',
    '',
    `  License validated: ${payload.tier} tier (org: ${payload.org}, expires: ${expires})`,
    '',
    'Questions? Reply to this email.',
    '',
    '— Bola Labs',
  ].join('\n')
}

/**
 * Send a license key to the recipient via Resend.
 *
 * Text-only body. Throws DeliveryError on non-2xx or network failure,
 * with `lid` attached so the caller can reconcile from the pending audit entry.
 */
export async function deliverLicense({ key, payload, recipient, fromEmail, resendApiKey }) {
  if (!key) throw new DeliveryError('key is required (cannot deliver a dry-run)', { lid: payload?.lid })
  if (!recipient) throw new DeliveryError('recipient is required', { lid: payload?.lid })
  if (!fromEmail) throw new DeliveryError('fromEmail is required', { lid: payload?.lid })
  if (!resendApiKey) throw new DeliveryError('resendApiKey is required', { lid: payload?.lid })

  const body = {
    from: fromEmail,
    to: [recipient],
    subject: 'Your GitHub Repo Manager license key',
    text: formatEmailBody({ key, payload }),
  }

  let response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new DeliveryError(`network error: ${e.message}`, { lid: payload?.lid })
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}))
    throw new DeliveryError(
      `Resend returned ${response.status}: ${errBody.message || 'unknown error'}`,
      { lid: payload?.lid }
    )
  }

  const json = await response.json()
  return { messageId: json.id }
}

const MAX_AUDIT_RETRIES = 3

/**
 * Build a single JSONL entry (one line, no trailing newline).
 * Uses JSON.stringify on the full object so `notes` and other string
 * fields are safely encoded — never concatenated into a template literal.
 */
function buildAuditEntry({ status, payload, fingerprint, notes, messageId, runId, kid }) {
  const entry = {
    ts: new Date().toISOString(),
    status,
    lid: payload.lid,
    kid,
    tier: payload.tier,
    org: payload.org,
    email: payload.email,
    seats: payload.seats,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    fingerprint,
    notes: notes || '',
    mintedBy: 'github-actions',
    runId: runId || null,
    messageId: messageId || null,
    dryRun: false,
  }
  return JSON.stringify(entry)
}

/**
 * Fetch + decode the current licenses.jsonl from the audit repo.
 * Returns { sha, lines } on 200, { sha: null, lines: [] } on 404.
 * Throws on any other error.
 */
async function fetchAuditFile({ auditRepo, pat, filename }) {
  const url = `https://api.github.com/repos/${auditRepo}/contents/${filename}`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (response.status === 404) return { sha: null, lines: [] }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new AuditWriteError(`GET audit failed: ${response.status} ${err.message || ''}`)
  }
  const body = await response.json()
  const content = Buffer.from(body.content, 'base64').toString('utf8')
  const lines = content.split('\n').filter(Boolean)
  return { sha: body.sha, lines }
}

/**
 * Put updated content to the audit file. sha is optional (absent = create).
 * Returns the new commit sha on success; throws AuditWriteError on 409 or other failure.
 */
async function putAuditFile({ auditRepo, pat, filename, sha, contentBase64, message }) {
  const url = `https://api.github.com/repos/${auditRepo}/contents/${filename}`
  const body = {
    message,
    content: contentBase64,
  }
  if (sha) body.sha = sha
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (response.status === 409) {
    throw new AuditWriteError('409 Conflict (sha mismatch)', { lastSha: sha })
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new AuditWriteError(`PUT audit failed: ${response.status} ${err.message || ''}`, { lastSha: sha })
  }
  const json = await response.json()
  return json.commit?.sha || 'unknown'
}

/**
 * Append (supersede pattern) a new audit entry to licenses.jsonl.
 *
 * Two-phase pattern: called first with status=pending (before email delivery),
 * then again with status=delivered (after). Each call APPENDS — the delivered
 * entry does not replace the pending entry, it supersedes it. Readers of the
 * audit file must collapse entries by `lid` at read time, interpreting the
 * latest entry as authoritative.
 *
 * Uses GitHub Contents API with optimistic concurrency (sha on PUT, retry on 409).
 * Entries NEVER include the license `key` field — only metadata.
 */
export async function logMint(params) {
  const {
    status, payload, fingerprint, notes, messageId,
    auditRepo, pat, runId, kid,
  } = params

  if (!auditRepo) throw new AuditWriteError('auditRepo is required')
  if (!pat) throw new AuditWriteError('pat is required')
  if (!payload?.lid) throw new AuditWriteError('payload.lid is required')

  const filename = 'licenses.jsonl'
  const entry = buildAuditEntry({ status, payload, fingerprint, notes, messageId, runId, kid })
  const commitMessage = `${status}: ${payload.lid} (${payload.tier}, ${payload.org})`

  let lastError
  for (let attempt = 1; attempt <= MAX_AUDIT_RETRIES; attempt++) {
    try {
      const { sha, lines } = await fetchAuditFile({ auditRepo, pat, filename })
      const newLines = [...lines, entry]
      const contentBase64 = Buffer.from(newLines.join('\n') + '\n').toString('base64')
      const commitSha = await putAuditFile({
        auditRepo, pat, filename, sha, contentBase64, message: commitMessage,
      })
      return { commitSha, entryIndex: newLines.length - 1 }
    } catch (e) {
      lastError = e
      if (e instanceof AuditWriteError && e.message.startsWith('409')) {
        // Retry on conflict — loop continues to refresh sha
        continue
      }
      throw e
    }
  }
  throw new AuditWriteError(
    `audit write failed after ${MAX_AUDIT_RETRIES} attempts (409 conflicts)`,
    { lastSha: lastError?.lastSha }
  )
}
