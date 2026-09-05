// SPDX-License-Identifier: Apache-2.0
/**
 * Digest e-mail delivery (G7) — the opt-in, scheduled counterpart to the
 * in-app notifications bell. Reuses buildNotificationsDigest (the exact
 * aggregation the bell renders — see notifications-digest.js) so the mailed
 * digest and the bell digest never drift apart; this module is purely
 * "who is due, and how do we render + send it".
 *
 * Scheduling lives in maintenance-janitors.js (the digest job), mirroring
 * the KPI snapshot job's cadence/guard/unref pattern.
 */
import db from '../db.js';
import logger from './logger.js';
import { config } from '../config.js';
import { sendEmail, isEmailDeliveryConfigured } from './email.js';
import { buildNotificationsDigest } from './notifications-digest.js';
import { issueUnsubscribeToken } from './digest-unsubscribe-token.js';

const PERIOD_MS = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
};

function toMs(iso) {
    if (!iso) return 0;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * Users whose opted-in digest is due as of `now` — 'off' users and users
 * with no e-mail on file are never candidates. A user with no
 * digest_last_sent_at yet (fresh opt-in) is always due, so turning the
 * setting on gets a digest on the very next pass rather than after a full
 * period of silence.
 *
 * @param {Date} [now]
 * @returns {Array<{id:number, username:string, email:string, digest_frequency:string, digest_last_sent_at:string|null, notifications_last_seen_at:string|null}>}
 */
export function findDueDigestUsers(now = new Date()) {
    const nowMs = now.getTime();
    const rows = db.prepare(`
        SELECT id, username, email, digest_frequency, digest_last_sent_at, notifications_last_seen_at
        FROM users
        WHERE digest_frequency IN ('daily', 'weekly')
          AND email IS NOT NULL AND TRIM(email) != ''
    `).all();
    return rows.filter((u) => {
        const periodMs = PERIOD_MS[u.digest_frequency];
        if (!periodMs) return false;
        if (!u.digest_last_sent_at) return true;
        return nowMs - toMs(u.digest_last_sent_at) >= periodMs;
    });
}

/** @param {number} userId @param {Date} [now] */
export function markDigestSent(userId, now = new Date()) {
    db.prepare('UPDATE users SET digest_last_sent_at = ? WHERE id = ?')
        .run(now.toISOString(), userId);
}

function digestTotal(digest) {
    return digest.totals.reviews + digest.totals.issues + digest.totals.failed_migrations + digest.totals.stale_pinned;
}

function digestSubject(digest) {
    const total = digestTotal(digest);
    if (total === 0) return 'Your GitHub Repo Manager digest — all quiet';
    return `Your GitHub Repo Manager digest — ${total} item${total === 1 ? '' : 's'} to look at`;
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function htmlList(items, render) {
    if (!items.length) return '<p style="color:#888;margin:4px 0 16px;">Nothing here.</p>';
    return `<ul style="padding-left:18px;margin:4px 0 16px;">${items.map((i) => `<li style="margin-bottom:4px;">${render(i)}</li>`).join('')}</ul>`;
}

function textList(items, render) {
    if (!items.length) return '  (none)';
    return items.map((i) => `  - ${render(i)}`).join('\n');
}

/**
 * @param {ReturnType<typeof buildNotificationsDigest>} digest
 * @param {{username: string, unsubscribeUrl: string}} opts
 */
export function buildDigestEmailHtml(digest, { username, unsubscribeUrl }) {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; line-height: 1.6; color: #222; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2>Hi ${escapeHtml(username || 'there')}, here's what's new</h2>
  <p style="color:#666;font-size:13px;">Since ${escapeHtml(digest.since)}</p>

  <h3 style="margin-bottom:0;">Reviews requested (${digest.totals.reviews})</h3>
  ${htmlList(digest.items.reviews, (r) => `<a href="https://github.com/${escapeHtml(r.repo)}/pull/${r.prNumber}">${escapeHtml(r.repo)} #${r.prNumber}</a> — ${escapeHtml(r.title)}`)}

  <h3 style="margin-bottom:0;">Issues assigned (${digest.totals.issues})</h3>
  ${htmlList(digest.items.issues, (r) => `<a href="https://github.com/${escapeHtml(r.repo)}/issues/${r.issueNumber}">${escapeHtml(r.repo)} #${r.issueNumber}</a> — ${escapeHtml(r.title)}`)}

  <h3 style="margin-bottom:0;">Failed migrations (${digest.totals.failed_migrations})</h3>
  ${htmlList(digest.items.failed_migrations, (r) => `${escapeHtml(r.repo)} — ${escapeHtml(r.reason)}`)}

  <h3 style="margin-bottom:0;">Stale pinned repos (${digest.totals.stale_pinned})</h3>
  ${htmlList(digest.items.stale_pinned, (r) => `${escapeHtml(r.repo)} — quiet since ${escapeHtml(r.lastActivity)}`)}

  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="font-size: 13px; color: #666;">
    You're getting this because you opted into email digests in GitHub Repo Manager.
    <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a> at any time — no login required.
  </p>
</body>
</html>`;
}

/**
 * @param {ReturnType<typeof buildNotificationsDigest>} digest
 * @param {{username: string, unsubscribeUrl: string}} opts
 */
export function buildDigestEmailText(digest, { username, unsubscribeUrl }) {
    return `Hi ${username || 'there'}, here's what's new
${'='.repeat(40)}

Since ${digest.since}

Reviews requested (${digest.totals.reviews})
${textList(digest.items.reviews, (r) => `${r.repo} #${r.prNumber} - ${r.title}`)}

Issues assigned (${digest.totals.issues})
${textList(digest.items.issues, (r) => `${r.repo} #${r.issueNumber} - ${r.title}`)}

Failed migrations (${digest.totals.failed_migrations})
${textList(digest.items.failed_migrations, (r) => `${r.repo} - ${r.reason}`)}

Stale pinned repos (${digest.totals.stale_pinned})
${textList(digest.items.stale_pinned, (r) => `${r.repo} - quiet since ${r.lastActivity}`)}

--
You're getting this because you opted into email digests in GitHub Repo Manager.
Unsubscribe (no login required): ${unsubscribeUrl}`;
}

/**
 * Build + send one user's due digest, recording digest_last_sent_at only on
 * a successful send — a failed send should be retried on the next pass, not
 * silently marked as delivered.
 *
 * @param {{id:number, username:string, email:string, notifications_last_seen_at:string|null}} user
 * @param {{now?: Date}} [opts]
 * @returns {Promise<boolean>}
 */
export async function sendDigestEmail(user, { now = new Date() } = {}) {
    const digest = buildNotificationsDigest(user.id, {
        now,
        last_seen_at: user.notifications_last_seen_at ?? null,
        login: user.username ?? null,
    });
    const token = issueUnsubscribeToken(user.id);
    const unsubscribeUrl = `${config.frontendUrl}/api/v1/notifications/digest/unsubscribe?token=${encodeURIComponent(token)}`;

    const result = await sendEmail({
        to: user.email,
        subject: digestSubject(digest),
        html: buildDigestEmailHtml(digest, { username: user.username, unsubscribeUrl }),
        text: buildDigestEmailText(digest, { username: user.username, unsubscribeUrl }),
        context: { kind: 'notifications_digest', userId: user.id },
    });

    if (result.ok) {
        markDigestSent(user.id, now);
    } else {
        logger.warn({ userId: user.id, error: result.error }, '[digest-mailer] send failed');
    }
    return result.ok;
}

/**
 * Send every due user's digest for this pass. No-ops entirely (never even
 * queries for due users) when email delivery isn't actually configured —
 * a digest nobody can receive isn't worth computing.
 *
 * @param {{now?: Date}} [opts]
 * @returns {Promise<{skipped: boolean, reason?: string, sent: number, checked: number}>}
 */
export async function runDigestPassOnce({ now = new Date() } = {}) {
    if (!isEmailDeliveryConfigured()) {
        return { skipped: true, reason: 'email_not_configured', sent: 0, checked: 0 };
    }

    const due = findDueDigestUsers(now);
    let sent = 0;
    for (const user of due) {
        try {
            if (await sendDigestEmail(user, { now })) sent++;
        } catch (err) {
            logger.warn({ err, userId: user.id }, '[digest-mailer] unexpected failure sending digest');
        }
    }
    return { skipped: false, sent, checked: due.length };
}
