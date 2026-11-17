// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs Licensed under the Apache License 2.0.

import { sendEmail } from './email.js'
import { headerSafe } from './email-identity.js'
import { renderEmail } from './email-layout.js'
import logger from './logger.js'

/**
 * The "you've been added to a team" mail. Both names are typed by users and
 * this mail goes out under the sending domain's DKIM signature; the layout
 * escapes every segment, so a team called `<a href=…>` stays text.
 *
 * @param {{ teamName: string, addedByUsername?: string|null }} opts
 * @returns {{ html: string, text: string }}
 */
export function buildAddedToTeamEmail({ teamName, addedByUsername }) {
    const team = { strong: teamName }
    const lead = addedByUsername
        ? [{ strong: addedByUsername }, ' added you to the ', team, ' team.']
        : ['You were added to the ', team, ' team.']
    return renderEmail({
        subject: `You've been added to ${teamName}`,
        preheader: addedByUsername ? `${addedByUsername} added you to ${teamName}.` : `You were added to ${teamName}.`,
        heading: "You've been added to a team",
        blocks: [
            { p: lead },
            { p: 'You can now see the repositories assigned to this team in GitHub Repo Manager.' },
            { p: ['Open the app and go to ', { strong: `Teams → ${teamName}` }, ' to get started.'] },
        ],
        why: "Didn't expect this? Contact whoever manages your organization's GitHub Repo Manager account.",
    })
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
            subject: `You've been added to ${headerSafe(teamName, 120)}`,
            ...buildAddedToTeamEmail({ teamName, addedByUsername }),
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
