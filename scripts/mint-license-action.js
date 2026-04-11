#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

/**
 * mint-license-action.js — CLI composition point for the GH Actions mint workflow.
 *
 * Invoked by .github/workflows/mint-license.yml. Reads config from env vars,
 * composes the primitives in scripts/lib/minter.js in order, maps errors to
 * exit codes, and writes $GITHUB_STEP_SUMMARY.
 *
 * Exit codes:
 *   0 — success (or dry-run success)
 *   2 — InputValidationError
 *   3 — MintError
 *   4 — AuditWriteError (pending phase)
 *   5 — DeliveryError
 *   6 — AuditWriteError (delivered phase)
 *   1 — any other error
 */

import { readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  validateInput,
  mintLicense,
  deliverLicense,
  logMint,
  InputValidationError,
  MintError,
  DeliveryError,
  AuditWriteError,
} from './lib/minter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const DEFAULT_PUBLIC_KEY_PATH = join(REPO_ROOT, 'keys', 'public.pem')

/**
 * Resolve the public key from env or disk.
 *
 * Tests set env.PUBLIC_KEY_PEM directly (they generate a throwaway keypair).
 * In production the workflow does not set it — the script reads the committed
 * keys/public.pem so there is a single source of truth. If Bruno ever rotates,
 * he updates both keys/public.pem (committed) and LICENSE_PRIVATE_PEM (GH Secret)
 * in the same PR, which makes misalignment impossible.
 */
function resolvePublicKey(env) {
  if (env.PUBLIC_KEY_PEM) return env.PUBLIC_KEY_PEM
  return readFileSync(DEFAULT_PUBLIC_KEY_PATH, 'utf8')
}

function writeSummary(summaryPath, lines) {
  if (!summaryPath) return
  try {
    appendFileSync(summaryPath, lines.join('\n') + '\n', 'utf8')
  } catch {
    // Best-effort; don't fail the mint because summary append failed
  }
}

export async function runMintAction({ env }) {
  const summaryPath = env.GITHUB_STEP_SUMMARY
  const runId = env.GITHUB_RUN_ID
  const kid = env.KID || 'k-default'
  const dryRun = env.DRY_RUN === 'true'

  // ---- Step 1: validate input
  let input
  try {
    input = validateInput({
      tier: env.TIER,
      org: env.ORG,
      email: env.EMAIL,
      seats: env.SEATS,
      months: env.MONTHS,
      notes: env.NOTES,
    })
  } catch (e) {
    process.stderr.write(`[validate] ${e.message}\n`)
    writeSummary(summaryPath, ['## ❌ License mint failed', '', `**Step:** validate`, `**Error:** ${e.message}`])
    return 2
  }

  // ---- Step 2: mint license
  let license
  let publicKeyPem
  try {
    publicKeyPem = resolvePublicKey(env)
  } catch (e) {
    process.stderr.write(`[mint] public key load failed: ${e.message}\n`)
    writeSummary(summaryPath, ['## ❌ License mint failed', '', `**Step:** mint`, `**Error:** cannot load public key: ${e.message}`])
    return 3
  }
  try {
    license = await mintLicense(input, {
      privateKeyPem: env.LICENSE_PRIVATE_PEM,
      publicKeyPem,
      kid,
      dryRun,
    })
  } catch (e) {
    process.stderr.write(`[mint] ${e.message}\n`)
    writeSummary(summaryPath, ['## ❌ License mint failed', '', `**Step:** mint`, `**Error:** ${e.message}`])
    return 3
  }

  // ---- Dry-run short-circuit: metadata summary + exit
  if (dryRun) {
    writeSummary(summaryPath, [
      '## 🧪 Dry-run mint (no email sent, no audit commit)',
      '',
      `| Field | Value |`,
      `|---|---|`,
      `| tier | ${license.payload.tier} |`,
      `| org | ${license.payload.org} |`,
      `| email | ${license.payload.email} |`,
      `| seats | ${license.payload.seats} |`,
      `| lid | ${license.payload.lid} |`,
      `| kid | ${license.kid} |`,
      `| fingerprint | ${license.fingerprint} |`,
      `| expiresAt | ${new Date(license.payload.exp * 1000).toISOString().slice(0, 10)} |`,
    ])
    return 0
  }

  // ---- Step 3: logMint(pending) — record BEFORE delivery
  try {
    await logMint({
      status: 'pending',
      payload: license.payload,
      fingerprint: license.fingerprint,
      notes: input.notes,
      auditRepo: env.AUDIT_REPO,
      pat: env.LICENSE_LOG_PAT,
      runId,
      kid: license.kid,
    })
  } catch (e) {
    process.stderr.write(`[audit-pending] ${e.message}\n`)
    writeSummary(summaryPath, ['## ❌ License mint failed', '', `**Step:** audit-pending`, `**Error:** ${e.message}`])
    return 4
  }

  // ---- Step 4: deliver
  let delivery
  try {
    delivery = await deliverLicense({
      key: license.key,
      payload: license.payload,
      recipient: input.email,
      fromEmail: env.FROM_EMAIL,
      resendApiKey: env.RESEND_API_KEY,
    })
  } catch (e) {
    process.stderr.write(`[deliver] ${e.message} (lid=${e.lid})\n`)
    writeSummary(summaryPath, [
      '## ⚠️ License minted but not delivered',
      '',
      `**Step:** deliver`,
      `**Error:** ${e.message}`,
      `**lid:** ${license.payload.lid} (recoverable from audit \`pending\` entry)`,
      `**fingerprint:** ${license.fingerprint}`,
    ])
    return 5
  }

  // ---- Step 5: logMint(delivered) — supersede the pending entry
  let deliveredAudit
  try {
    deliveredAudit = await logMint({
      status: 'delivered',
      payload: license.payload,
      fingerprint: license.fingerprint,
      notes: input.notes,
      messageId: delivery.messageId,
      auditRepo: env.AUDIT_REPO,
      pat: env.LICENSE_LOG_PAT,
      runId,
      kid: license.kid,
    })
  } catch (e) {
    process.stderr.write(`[audit-delivered] ${e.message}\n`)
    writeSummary(summaryPath, [
      '## ⚠️ License delivered but delivered-status audit write failed',
      '',
      `**Step:** audit-delivered`,
      `**Error:** ${e.message}`,
      `**lid:** ${license.payload.lid}`,
      `**messageId:** ${delivery.messageId}`,
      `**Note:** customer has the working key. Audit shows \`pending\` forever. Manually reconcile if needed.`,
    ])
    return 6
  }

  // ---- Success summary
  writeSummary(summaryPath, [
    '## ✅ License minted and delivered',
    '',
    `| Field | Value |`,
    `|---|---|`,
    `| tier | ${license.payload.tier} |`,
    `| org | ${license.payload.org} |`,
    `| email | ${license.payload.email} |`,
    `| seats | ${license.payload.seats} |`,
    `| lid | ${license.payload.lid} |`,
    `| kid | ${license.kid} |`,
    `| fingerprint | ${license.fingerprint} |`,
    `| expiresAt | ${new Date(license.payload.exp * 1000).toISOString().slice(0, 10)} |`,
    `| messageId | ${delivery.messageId} |`,
    `| auditCommit | ${deliveredAudit.commitSha} |`,
  ])
  return 0
}

// Main entry when run as a script (not imported by tests)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mint-license-action.js')) {
  runMintAction({ env: process.env }).then((code) => process.exit(code ?? 1)).catch((e) => {
    process.stderr.write(`[fatal] ${e.message}\n`)
    process.exit(1)
  })
}
