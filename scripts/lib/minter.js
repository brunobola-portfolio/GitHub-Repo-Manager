// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

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
 */
function fingerprintPublicKey(publicKeyPem) {
  const hash = createHash('sha256').update(publicKeyPem).digest('hex')
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
