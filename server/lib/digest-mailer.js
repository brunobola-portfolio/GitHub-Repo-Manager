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
import { renderEmail } from './email-layout.js';

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

function readableDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? String(iso ?? '')
        : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const gh = (repo, kind, n) => ({ link: { url: `https://github.com/${repo}/${kind}/${n}`, label: `${repo} #${n}` } });

/**
 * Only the sections with something in them; an all-quiet digest says so in
 * one line instead of four "Nothing here." headings.
 *
 * @param {ReturnType<typeof buildNotificationsDigest>} digest
 * @param {{username: string, unsubscribeUrl: string, appUrl?: string}} opts
 * @returns {{ html: string, text: string }}
 */
export function buildDigestEmail(digest, { username, unsubscribeUrl, appUrl }) {
    const sections = [
        ['Reviews requested', digest.items.reviews, (r) => ({ title: gh(r.repo, 'pull', r.prNumber), meta: r.title })],
        ['Issues assigned to you', digest.items.issues, (r) => ({ title: gh(r.repo, 'issues', r.issueNumber), meta: r.title })],
        ['Failed migrations', digest.items.failed_migrations, (r) => ({ title: r.repo, meta: r.reason })],
        ['Pinned repos gone quiet', digest.items.stale_pinned, (r) => ({ title: r.repo, meta: `Quiet since ${readableDate(r.lastActivity)}` })],
    ].filter(([, items]) => items.length);

    const total = digestTotal(digest);
    const blocks = [{ p: `Here is what changed since ${readableDate(digest.since)}.` }];
    if (!sections.length) blocks.push({ p: 'Nothing needs you right now.' });
    for (const [label, items, render] of sections) {
        blocks.push({ h: `${label} (${items.length})` }, { items: items.map(render) });
    }
    if (appUrl) blocks.push({ button: { label: 'Open GitHub Repo Manager', url: appUrl } });

    return renderEmail({
        subject: digestSubject(digest),
        preheader: total === 0 ? 'All quiet since your last digest.' : `${total} item${total === 1 ? '' : 's'} to look at.`,
        heading: `Hi ${username || 'there'}, here's what's new`,
        blocks,
        why: ["You're getting this because you opted into email digests. ", { link: { url: unsubscribeUrl, label: 'Unsubscribe' } }, ' at any time, no sign-in needed.'],
        help: false,
    });
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
        ...buildDigestEmail(digest, { username: user.username, unsubscribeUrl, appUrl: config.frontendUrl }),
        context: { kind: 'notifications_digest', userId: user.id },
        // The body carries a live unsubscribe token, and a failed digest is
        // already re-sent by the next pass (digest_last_sent_at only moves on
        // success) — queuing it too would store the token and mail it twice.
        deadLetter: 'skip',
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
