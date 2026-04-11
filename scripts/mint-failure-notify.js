// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.

/**
 * mint-failure-notify.js — standalone failure notifier for the mint workflow.
 *
 * Invoked by the `if: failure()` step in .github/workflows/mint-license.yml.
 * Sends a minimal email to Bruno containing only the run URL, event type,
 * and repo — NO license key or fingerprint or any other crypto material.
 *
 * Kept as a separate script (not part of mint-license-action.js) because
 * the main script may have crashed before its own handler could run — a
 * completely independent process is needed for reliable failure reporting.
 */

import { parseArgs } from 'node:util'

export async function notifyFailure({ resendApiKey, fromEmail, toEmail, runId, repo, eventName }) {
  if (!resendApiKey) {
    // Graceful degradation — if Resend isn't configured, exit silently.
    // This is already a failure handler; we don't want to fail on failure.
    return
  }

  const runUrl = `https://github.com/${repo}/actions/runs/${runId}`
  const text = [
    'The License Mint workflow failed.',
    '',
    `Repository: ${repo}`,
    `Event: ${eventName}`,
    `Run ID: ${runId}`,
    `Run URL: ${runUrl}`,
    '',
    'Check the run logs and step summary for details.',
    'This notification contains no license material by design.',
    '',
    '— Mint failure notifier',
  ].join('\n')

  const body = {
    from: fromEmail || 'licenses@bolalabs.pt',
    to: [toEmail || 'bruno@bolalabs.pt'],
    subject: `⚠️ License mint workflow failed (${eventName})`,
    text,
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      process.stderr.write(`[notify] Resend returned ${response.status}\n`)
    }
  } catch (e) {
    process.stderr.write(`[notify] network error: ${e.message}\n`)
  }
}

// Main entry when run as a script
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mint-failure-notify.js')) {
  const { values } = parseArgs({
    options: {
      'run-id': { type: 'string' },
      'repo': { type: 'string' },
      'event': { type: 'string' },
    },
  })
  notifyFailure({
    resendApiKey: process.env.RESEND_API_KEY,
    fromEmail: 'licenses@bolalabs.pt',
    toEmail: 'bruno@bolalabs.pt',
    runId: values['run-id'],
    repo: values['repo'],
    eventName: values['event'],
  }).finally(() => process.exit(0))
}
