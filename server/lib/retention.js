// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.

import db from '../db.js'
import { auditLogDirect } from './audit.js'
import { sendEmail } from './email.js'
import logger from './logger.js'

/**
 * Build the HTML warning email body.
 *
 * @param {object} opts
 * @param {string} opts.purgeDate  — ISO date string YYYY-MM-DD
 * @returns {string}
 */
function buildWarningHtml({ purgeDate }) {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; line-height: 1.6; color: #222; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2>Your AI credentials will be removed on ${purgeDate}</h2>
  <p>
    GitHub Repo Manager stores your AI API credentials (Bring-Your-Own-Key)
    to power features such as AI chat, code review suggestions, and smart search.
  </p>
  <p>
    Our data retention policy requires that credentials unused for
    <strong>365 days</strong> are automatically deleted for your security.
  </p>
  <p>
    <strong>Your credentials are scheduled to be erased on ${purgeDate}.</strong>
  </p>
  <h3>What can you do?</h3>
  <ul>
    <li>
      <strong>Keep your credentials</strong>: Simply use any AI-powered feature in
      GitHub Repo Manager before the purge date. Activity resets the retention clock.
    </li>
    <li>
      <strong>Let them expire</strong>: If you no longer use the app, no action
      is needed. Your credentials will be permanently deleted on the purge date.
      You can re-add them at any time via Settings → AI &amp; Keys.
    </li>
  </ul>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="font-size: 13px; color: #666;">
    Questions? Contact us at
    <a href="mailto:bruno@bolalabs.pt">bruno@bolalabs.pt</a>.
  </p>
</body>
</html>`
}

/**
 * Build the plain-text fallback for the retention warning.
 *
 * @param {object} opts
 * @param {string} opts.purgeDate
 * @returns {string}
 */
function buildWarningText({ purgeDate }) {
    return `Your AI credentials will be removed on ${purgeDate}
===========================================================

GitHub Repo Manager stores your AI API credentials (Bring-Your-Own-Key)
to power features such as AI chat, code review suggestions, and smart search.

Our data retention policy requires that credentials unused for 365 days are
automatically deleted for your security.

Your credentials are scheduled to be erased on ${purgeDate}.

What can you do?
----------------
- Keep your credentials: Simply use any AI-powered feature in GitHub Repo
  Manager before the purge date. Activity resets the retention clock.
- Let them expire: If you no longer use the app, no action is needed. Your
  credentials will be permanently deleted on the purge date. You can re-add
  them at any time via Settings -> AI & Keys.

Questions? Contact us at bruno@bolalabs.pt`
}

/**
 * Scheduled task: enforce data retention on user_ai_config rows.
 *
 * For each row whose updated_at is old:
 *   1. If within the warning window and warning hasn't been sent yet,
 *      send a warning email and record warning_sent_at.
 *   2. If past the purge date, delete the credentials and log an audit event.
 *
 * @param {object} [opts]
 * @param {Date}    [opts.now=new Date()]     — reference "now" (injectable for tests)
 * @param {boolean} [opts.dryRun=false]       — when true, all logic runs but DB writes are skipped
 * @returns {Promise<{
 *   checked: number,
 *   warned: number,
 *   purged: number,
 *   skipped: number,
 *   dryRun: boolean
 * }>}
 */
export async function runRetentionPass({ now = new Date(), dryRun = false } = {}) {
    const retentionDays = parseInt(process.env.DATA_RETENTION_DAYS ?? '365', 10)
    const warningLeadDays = parseInt(process.env.DATA_RETENTION_WARNING_LEAD_DAYS ?? '30', 10)

    const retentionMs = retentionDays * 24 * 60 * 60 * 1000
    const warningLeadMs = warningLeadDays * 24 * 60 * 60 * 1000

    const purgeThreshold = new Date(now.getTime() - retentionMs)
    const warningThreshold = new Date(now.getTime() - (retentionMs - warningLeadMs))

    logger.info(
        { retentionDays, warningLeadDays, purgeThreshold: purgeThreshold.toISOString(), warningThreshold: warningThreshold.toISOString(), dryRun },
        'retention: starting pass'
    )

    // Fetch all rows that are approaching or past the purge threshold.
    // We include all rows that are older than (retentionDays - warningLeadDays).
    const rows = db.prepare(`
        SELECT uac.user_id, uac.updated_at, uac.warning_sent_at,
               u.email AS user_email
        FROM user_ai_config uac
        LEFT JOIN users u ON u.id = uac.user_id
        WHERE uac.updated_at <= ?
          AND (uac.completion_credentials_enc IS NOT NULL OR uac.embedding_credentials_enc IS NOT NULL)
    `).all(warningThreshold.toISOString())

    const stats = { checked: rows.length, warned: 0, purged: 0, skipped: 0, dryRun }

    for (const row of rows) {
        const updatedAt = new Date(row.updated_at)
        const isPastPurge = updatedAt <= purgeThreshold

        if (isPastPurge) {
            // Purge: delete the encrypted credentials from this row.
            logger.info({ userId: row.user_id, updatedAt: row.updated_at, dryRun }, 'retention: purging credentials')

            if (!dryRun) {
                db.prepare(`
                    UPDATE user_ai_config
                    SET completion_credentials_enc = NULL,
                        embedding_credentials_enc = NULL
                    WHERE user_id = ?
                `).run(row.user_id)

                // Audit event via auditLogDirect to preserve the hash chain.
                auditLogDirect({
                    actor_user_id: row.user_id,
                    action: 'user_ai_config.purged',
                    entity_type: 'user_ai_config',
                    entity_id: String(row.user_id),
                    metadata: { reason: 'data_retention', updatedAt: row.updated_at },
                })
            }

            stats.purged++
            continue
        }

        // Within warning window — send warning if not already sent
        if (row.warning_sent_at) {
            stats.skipped++
            continue
        }

        const recipientEmail = row.user_email
        if (!recipientEmail) {
            logger.warn({ userId: row.user_id }, 'retention: no email address for user — skipping warning')
            stats.skipped++
            continue
        }

        // Rendered as "12 March 2027": this lands in a subject line a person
        // reads, and an ISO date there reads as machine output.
        const purgeDate = new Date(updatedAt.getTime() + retentionMs)
            .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

        logger.info({ userId: row.user_id, purgeDate, dryRun }, 'retention: sending warning email')

        if (!dryRun) {
            try {
                await sendEmail({
                    to: recipientEmail,
                    subject: `Action required: your AI credentials will be removed on ${purgeDate}`,
                    html: buildWarningHtml({ purgeDate }),
                    text: buildWarningText({ purgeDate }),
                })
            } catch (err) {
                logger.error({ err, userId: row.user_id }, 'retention: failed to send warning email')
                stats.skipped++
                continue
            }

            db.prepare(`
                UPDATE user_ai_config SET warning_sent_at = ? WHERE user_id = ?
            `).run(now.toISOString(), row.user_id)
        }

        stats.warned++
    }

    logger.info(stats, 'retention: pass complete')
    return stats
}
