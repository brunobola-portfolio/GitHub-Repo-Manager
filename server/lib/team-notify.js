// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

import { sendEmail } from './email.js'
import logger from './logger.js'

/**
 * Build the HTML email body for a "you've been added to a team" notification.
 *
 * @param {object} opts
 * @param {string} opts.teamName
 * @param {string|null} [opts.addedByUsername]
 * @returns {string} HTML
 */
function buildAddedToTeamEmailHtml({ teamName, addedByUsername }) {
    const addedByLine = addedByUsername
        ? `<p><strong>${addedByUsername}</strong> added you to the <strong>${teamName}</strong> team.</p>`
        : `<p>You were added to the <strong>${teamName}</strong> team.</p>`
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; line-height: 1.6; color: #222; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2>You've been added to a team</h2>
  ${addedByLine}
  <p>You can now see the repositories assigned to this team in GitHub Repo Manager.</p>
  <p>Open the app and go to <strong>Teams → ${teamName}</strong> to get started.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="font-size: 13px; color: #666;">
    Didn't expect this? Contact whoever manages your organization's GitHub Repo Manager account, or
    <a href="mailto:bruno@bolalabs.pt">bruno@bolalabs.pt</a>.
  </p>
</body>
</html>`
}

/**
 * Build the plain-text fallback for the "added to team" notification email.
 *
 * @param {object} opts
 * @param {string} opts.teamName
 * @param {string|null} [opts.addedByUsername]
 * @returns {string}
 */
function buildAddedToTeamEmailText({ teamName, addedByUsername }) {
    const addedByLine = addedByUsername
        ? `${addedByUsername} added you to the ${teamName} team.`
        : `You were added to the ${teamName} team.`
    return `You've been added to a team
============================

${addedByLine}

You can now see the repositories assigned to this team in GitHub Repo Manager.

Open the app and go to Teams -> ${teamName} to get started.

Didn't expect this? Contact whoever manages your organization's GitHub Repo Manager account, or bruno@bolalabs.pt`
}

/**
 * Notify a user by email that they've been added to a team. Best-effort:
 * this never throws — a missing email address, a delivery failure, or any
 * unexpected error all resolve to `{ notified: false }` rather than
 * rejecting, because a notification failure must never block the member
 * being added to the team.
 *
 * There is no in-app notification store today (see docs/architecture/teams.md);
 * this is the only notification channel until one exists.
 *
 * @param {object} opts
 * @param {string|null|undefined} opts.email — recipient's known email, if any
 * @param {string} opts.username — GitHub username of the added member (for logging)
 * @param {string} opts.teamName
 * @param {string|null} [opts.addedByUsername] — username of the admin/owner who added them
 * @returns {Promise<{ notified: boolean, reason?: string }>}
 */
export async function notifyMemberAdded({ email, username, teamName, addedByUsername = null }) {
    if (!email) {
        logger.info({ username, teamName }, '[team-notify] no email on file — skipping notification')
        return { notified: false, reason: 'no_email' }
    }

    try {
        const result = await sendEmail({
            to: email,
            subject: `You've been added to ${teamName}`,
            html: buildAddedToTeamEmailHtml({ teamName, addedByUsername }),
            text: buildAddedToTeamEmailText({ teamName, addedByUsername }),
            context: { kind: 'team_member_added', teamName },
        })

        if (!result.ok) {
            logger.warn(
                { username, teamName, error: result.error },
                '[team-notify] email delivery failed — member was still added to the team'
            )
            return { notified: false, reason: 'delivery_failed' }
        }

        return { notified: true }
    } catch (err) {
        logger.error({ err, username, teamName }, '[team-notify] unexpected error sending notification email')
        return { notified: false, reason: 'error' }
    }
}
