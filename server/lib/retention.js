// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs Licensed under the Apache License 2.0.

import db from '../db.js'
import { auditLogDirect } from './audit.js'
import { isEmailDeliveryConfigured, sendEmail } from './email.js'
import { renderEmail } from './email-layout.js'
import logger from './logger.js'

/**
 * The 30-day warning before unused AI credentials are erased.
 *
 * @param {{ purgeDate: string, retentionDays?: number }} opts  purgeDate is a date a person reads, e.g. "12 March 2027"
 * @returns {{ html: string, text: string }}
 */
export function buildWarningEmail({ purgeDate, retentionDays = 365 }) {
    return renderEmail({
        subject: `Action required: your AI credentials will be removed on ${purgeDate}`,
        preheader: `Use any AI feature before ${purgeDate} to keep them.`,
        eyebrow: 'Data retention',
        heading: `Your AI credentials will be removed on ${purgeDate}`,
        blocks: [
            { p: 'GitHub Repo Manager stores the AI API credentials you added (Bring-Your-Own-Key) to power features such as AI chat, code review suggestions and smart search.' },
            { p: ['Credentials that go unused for ', { strong: `${retentionDays} days` }, ' are erased automatically, so a key you have stopped using cannot sit here indefinitely.'] },
            { facts: [{ label: 'Erased on', value: { strong: purgeDate } }] },
            { h: 'What can you do?' },
            { p: [{ strong: 'Keep them:' }, ' use any AI feature in GitHub Repo Manager before that date. Activity resets the clock.'] },
            { p: [{ strong: 'Let them go:' }, ' if you no longer use the app, do nothing. They are deleted permanently on that date, and you can add them again at any time under Settings → AI & Keys.'] },
        ],
        why: 'You are getting this because AI credentials saved on your account have not been used for a long time.',
        help: 'Questions?',
    })
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

    // A warning "sent" through the console adapter still sets warning_sent_at,
    // and 30 days later the credentials are deleted for real — this is the one
    // promise in the pass that must never be faked. When mail cannot leave the
    // box, hold the warnings (the rows stay unwarned, so they are sent once
    // EMAIL_PROVIDER is set) while still purging what is already past due.
    const emailOff = !dryRun && !isEmailDeliveryConfigured()
    if (emailOff && rows.length > 0) {
        logger.warn({ rows: rows.length }, 'retention: email delivery not configured — warnings held, nothing marked as warned')
    }

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

        if (emailOff) {
            stats.skipped++
            continue
        }

        if (!dryRun) {
            let result
            try {
                result = await sendEmail({
                    to: recipientEmail,
                    subject: `Action required: your AI credentials will be removed on ${purgeDate}`,
                    ...buildWarningEmail({ purgeDate, retentionDays }),
                })
            } catch (err) {
                logger.error({ err, userId: row.user_id }, 'retention: failed to send warning email')
                stats.skipped++
                continue
            }

            // sendEmail RESOLVES with { ok: false } for a 4xx (a rejected key,
            // an unverified sender, a bad address) — it only throws on the
            // unexpected. The catch above therefore never saw the most likely
            // failure, and warning_sent_at was written anyway: 30 days later
            // the credentials were purged having warned nobody. This is the
            // one promise in the pass that must never be faked, so the row
            // stays unwarned and the next pass tries again.
            if (!result?.ok) {
                logger.error({ userId: row.user_id, error: result?.error }, 'retention: warning email not accepted — leaving the row unwarned')
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
