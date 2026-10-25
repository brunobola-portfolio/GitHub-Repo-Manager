// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs Licensed under the Apache License 2.0.

import { decodeJwt } from 'jose'
import { generateLicenseKey, addCalendarMonths, revokeLicense, LICENSE_PREFIX } from './license.js'
import { isEmailDeliveryConfigured, sendEmail } from './email.js'
import { renderEmail } from './email-layout.js'
import db from '../db.js'
import logger from './logger.js'

/** Dead-letter `context.kind` of a licence email; see licenseEmailDeadLetterHandler. */
export const LICENSE_EMAIL_KIND = 'license_key'

const DAY = 24 * 60 * 60

/**
 * Days a Stripe key outlives the period it was paid for. The renewal key is
 * minted when the next invoice is paid, which Stripe does about an hour after
 * the period ends and, under dunning, days later. A key that ended with the
 * period put every monthly self-hosted install on Free for that gap.
 */
export function licenseGraceDays(raw = process.env.LICENSE_GRACE_DAYS) {
    const n = Number.parseInt(raw ?? '', 10)
    return Number.isFinite(n) && n >= 0 && n <= 30 ? n : 7
}

/**
 * Unix seconds the key should stop at: the paid period's end plus grace, or a
 * calendar-month count from now when Stripe gave no period end.
 */
export function licenseExpiry({ periodEnd, months, now = Math.floor(Date.now() / 1000) }) {
    if (Number.isFinite(periodEnd) && periodEnd > now) return Math.floor(periodEnd) + licenseGraceDays() * DAY
    return addCalendarMonths(now, months > 0 ? months : 1)
}

const FREE_MAIL = new Set([
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com',
    'gmx.net', 'aol.com', 'mail.com', 'sapo.pt', 'zoho.com', 'yandex.com', 'hey.com',
])

/**
 * The `org` claim: who the key is for, as the buyer gave it. Business name
 * first, then the Stripe customer name, then a company email domain. The key
 * is pasted into third-party machines and support tickets, so the tax id
 * never goes in it.
 *
 * @param {{ businessName?: string|null, customerName?: string|null, email?: string|null }} src
 * @returns {string|null}
 */
export function resolveLicenseOrg({ businessName, customerName, email } = {}) {
    for (const candidate of [businessName, customerName]) {
        const clean = String(candidate ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
        if (clean) return clean.slice(0, 120)
    }
    const domain = String(email ?? '').split('@')[1]?.toLowerCase().trim()
    if (domain && !FREE_MAIL.has(domain)) return domain
    return email ? String(email).trim().slice(0, 120) : null
}

function formatDate(unixSeconds) {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

/**
 * What the customer must do, in plain language. The key's real end date is
 * printed, because "valid for 1 month" said nothing about when to act, and
 * the old monthly line told self-hosters nothing was required while they had
 * to paste a new key every month.
 */
function describeLicenseValidity({ expiresAt, billingPeriod }) {
    const until = expiresAt ? `This key is valid until ${formatDate(expiresAt)}.` : ''
    const renew = billingPeriod === 'yearly'
        ? 'Each yearly renewal emails you a new key.'
        : 'Each monthly renewal emails you a new key a few days before this one stops.'
    return `${until} ${renew} On the hosted app nothing changes. Your own install picks each new key up at its daily check-in; an install without network access pastes it under Settings → License & Plan.`.trim()
}

function tierLabelOf(tier) {
    return tier.charAt(0).toUpperCase() + tier.slice(1)
}

function buildLicenseEmail({ tier, licenseKey, expiresAt, billingPeriod, renewal }) {
    const tierLabel = tierLabelOf(tier)
    const facts = [{ label: 'Plan', value: `${tierLabel}, billed ${billingPeriod === 'yearly' ? 'yearly' : 'monthly'}` }]
    if (expiresAt) facts.push({ label: 'Valid until', value: { strong: formatDate(expiresAt) } })
    return renderEmail({
        subject: licenseSubject(tier, renewal),
        preheader: renewal
            ? `Your ${tierLabel} plan renewed. Here is the key for the new period.`
            : `Your ${tierLabel} key, and whether you need to paste it anywhere.`,
        eyebrow: `${tierLabel} plan`,
        heading: `${renewal ? 'Your renewed' : 'Your'} GitHub Repo Manager license key`,
        blocks: [
            {
                p: renewal
                    ? ['Your ', { strong: tierLabel }, ' plan renewed. Here is the key for the new period.']
                    : ['Thank you for subscribing to the ', { strong: tierLabel }, ' plan. Your license key is:'],
            },
            { secret: licenseKey },
            { facts },
            { h: 'Do I need to activate it?' },
            { p: [{ strong: 'Using the hosted app?' }, ` No. Your ${tierLabel} plan is already active on your account; there is nothing to paste.`] },
            { p: [{ strong: 'Running your own install?' }, ' An administrator of that install opens ', { strong: 'Settings → License & Plan → Activate' }, ' and pastes the key. It applies to every account on the install.'] },
            { p: describeLicenseValidity({ expiresAt, billingPeriod }) },
            { note: 'Keep this key safe and treat it like a password. Cancelling your subscription does not switch it off: it keeps working to the end of the period you paid for. A refunded payment revokes it.' },
        ],
        why: `You are getting this because you subscribed to GitHub Repo Manager ${tierLabel}.`,
    })
}

function licenseSubject(tier, renewal = false) {
    return renewal
        ? `Your renewed GitHub Repo Manager license — ${tier} plan`
        : `Your GitHub Repo Manager license — ${tier} plan`
}

function unixOf(iso) {
    const t = iso ? Date.parse(iso) : NaN
    return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

/**
 * Dead-letter handler for licence emails. The queue row holds only
 * `{ kind, stripeSessionId, tier, months, renewal }`; the key is read back
 * from `issued_licenses` — the one place it is meant to live — when the
 * worker sends, and a delivered retry records itself there like a first-try
 * success.
 */
export const licenseEmailDeadLetterHandler = {
    rebuild(context) {
        if (!context?.stripeSessionId) return null
        const row = db.prepare(
            'SELECT license_key, tier, expires_at, billing_period FROM issued_licenses WHERE stripe_session_id = ?'
        ).get(context.stripeSessionId)
        if (!row?.license_key) return null
        const tier = row.tier || context.tier
        const view = {
            tier,
            licenseKey: row.license_key,
            expiresAt: unixOf(row.expires_at),
            billingPeriod: row.billing_period || (context.months >= 12 ? 'yearly' : 'monthly'),
            renewal: context.renewal === true,
        }
        return {
            subject: licenseSubject(tier, view.renewal),
            ...buildLicenseEmail(view),
        }
    },
    onDelivered(context) {
        if (!context?.stripeSessionId) return
        markEmailDelivered(context.stripeSessionId)
    },
}

function markEmailDelivered(stripeSessionId) {
    db.prepare(`
        UPDATE issued_licenses
        SET email_delivered = 1, email_delivered_at = datetime('now')
        WHERE stripe_session_id = ? AND email_delivered = 0
    `).run(stripeSessionId)
}

function lidOf(licenseKey) {
    try {
        const lid = decodeJwt(licenseKey.slice(LICENSE_PREFIX.length)).lid
        return typeof lid === 'string' ? lid : null
    } catch {
        return null
    }
}

/**
 * Issue a license key on behalf of a checkout session or paid renewal invoice
 * AND email it to the recipient. Called from the Stripe webhook.
 *
 * Idempotent per stripe_session_id: if a row already exists for this
 * session, the existing license key is returned without sending another email.
 *
 * Throws when signing or persisting fails, so the webhook answers 5xx and
 * Stripe retries: returning null used to answer 200 for a paid key that did
 * not exist. A missing signing key still returns null — production refuses
 * to boot without it when Stripe is on (startup-secrets-check.js).
 *
 * @param {object} opts
 * @param {number} opts.userId
 * @param {string} opts.email
 * @param {string} opts.tier           — 'pro' | 'enterprise'
 * @param {number} [opts.seats=1]
 * @param {number} [opts.months=1]     — fallback validity when no period end is known
 * @param {number|null} [opts.periodEnd] — unix seconds the paid period ends
 * @param {'monthly'|'yearly'} [opts.billingPeriod]
 * @param {string|null} [opts.org]
 * @param {boolean} [opts.renewal=false]
 * @param {string} opts.stripeSubscriptionId
 * @param {string} opts.stripeSessionId — checkout session id, or invoice id for a renewal
 * @returns {Promise<{ licenseKey: string|null, emailDelivered: boolean }>}
 */
export async function issueLicenseForCheckout(opts) {
    const {
        userId,
        email,
        tier,
        seats = 1,
        months = 1,
        periodEnd = null,
        org = null,
        renewal = false,
        stripeSubscriptionId,
        stripeSessionId,
    } = opts
    const billingPeriod = opts.billingPeriod || (months >= 12 ? 'yearly' : 'monthly')

    // Idempotency: return existing record for this session without re-emailing.
    const existing = db.prepare(
        'SELECT license_key, email_delivered FROM issued_licenses WHERE stripe_session_id = ?'
    ).get(stripeSessionId)

    if (existing) {
        logger.info({ stripeSessionId }, 'license-issuer: license already issued for this session (idempotent return)')
        return {
            licenseKey: existing.license_key,
            emailDelivered: existing.email_delivered === 1,
        }
    }

    // Resolve the signing key from env
    const privateKeyPem = process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM
    if (!privateKeyPem) {
        if (process.env.NODE_ENV === 'production') {
            logger.fatal({ stripeSessionId }, 'license-issuer: LICENSE_SIGNING_PRIVATE_KEY_PEM not set in production — license not issued')
        } else {
            logger.warn({ stripeSessionId }, 'license-issuer: LICENSE_SIGNING_PRIVATE_KEY_PEM not set — skipping license generation (dev mode)')
        }
        return { licenseKey: null, emailDelivered: false }
    }

    const expiresAtUnix = licenseExpiry({ periodEnd, months })

    let licenseKey
    try {
        licenseKey = await generateLicenseKey(
            { org: org || undefined, email, tier, seats, months, expiresAt: expiresAtUnix },
            privateKeyPem
        )
    } catch (err) {
        logger.error({ err, stripeSessionId }, 'license-issuer: key generation failed')
        throw new Error('License key generation failed', { cause: err })
    }

    // Stored with the same value signed into `exp`, so the record cannot
    // drift from what the key enforces.
    const expiresAt = new Date(expiresAtUnix * 1000).toISOString()
    const periodEndIso = Number.isFinite(periodEnd) ? new Date(periodEnd * 1000).toISOString() : null

    try {
        db.prepare(`
            INSERT OR IGNORE INTO issued_licenses
                (user_id, stripe_subscription_id, stripe_session_id, tier, license_key, expires_at,
                 lid, org, billing_period, period_end)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userId, stripeSubscriptionId, stripeSessionId, tier, licenseKey, expiresAt,
            lidOf(licenseKey), org, billingPeriod, periodEndIso)
    } catch (err) {
        logger.error({ err, stripeSessionId }, 'license-issuer: failed to persist issued license')
        throw new Error('License persistence failed', { cause: err })
    }

    // Send the license email (best-effort), but only when mail can actually
    // leave the box. The console adapter returns ok for a message nobody
    // receives — and deliberately does not log the body, because the body is a
    // license key — so sending a paid key through it would mark this row
    // email_delivered=1 for a key the customer never got, and no route hands an
    // owner their key back. Leaving the row undelivered is the honest state:
    // with EMAIL_PROVIDER=resend it goes out for real, and until then the log
    // says a key is owed.
    let emailDelivered = false
    if (!isEmailDeliveryConfigured()) {
        logger.warn(
            { stripeSessionId, userId, tier },
            'license-issuer: email delivery not configured — license persisted, NOT sent, email_delivered=0; set EMAIL_PROVIDER=resend'
        )
        return { licenseKey, emailDelivered: false, emailConfigured: false }
    }
    const view = { tier, licenseKey, expiresAt: expiresAtUnix, billingPeriod, renewal }
    try {
        const result = await sendEmail({
            to: email,
            subject: licenseSubject(tier, renewal),
            ...buildLicenseEmail(view),
            stream: 'licences',
            // The body is the key: queue the reference, never the secret.
            deadLetter: 'rebuild',
            context: { kind: LICENSE_EMAIL_KIND, stripeSessionId, tier, months, renewal },
            // One logical message per checkout session, so a webhook redelivery
            // racing a timed-out first send cannot mail the key twice.
            idempotencyKey: `license-${stripeSessionId}`,
        })

        if (result.ok) {
            emailDelivered = true
            markEmailDelivered(stripeSessionId)
        } else {
            logger.warn({ stripeSessionId, error: result.error }, 'license-issuer: email delivery failed; license persisted with email_delivered=0')
        }
    } catch (err) {
        logger.error({ err, stripeSessionId }, 'license-issuer: unexpected error during email send')
    }

    return { licenseKey, emailDelivered }
}

/** Keys of a subscription that still work: signed with a lid, not revoked, not expired. */
export const LIVE_SUBSCRIPTION_KEYS_SQL = `
    SELECT lid, org, tier, expires_at FROM issued_licenses
    WHERE stripe_subscription_id = ? AND lid IS NOT NULL AND revoked_at IS NULL
      AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))`

/**
 * Revoke every live key of a subscription: a full refund or a lost dispute
 * means the money that paid for them is gone. The hosted instance stops
 * honouring them at once (revoked_licenses + cache refresh by the caller);
 * an offline install keeps one until its `exp`, which is the period end plus
 * grace, not a year.
 *
 * @param {string} stripeSubscriptionId
 * @param {'refund'|'dispute'} reason
 * @returns {number} keys revoked
 */
export function revokeSubscriptionLicenses(stripeSubscriptionId, reason) {
    const rows = db.prepare(LIVE_SUBSCRIPTION_KEYS_SQL).all(stripeSubscriptionId)
    const mark = db.prepare(`
        UPDATE issued_licenses SET revoked_at = datetime('now'), revoke_reason = ? WHERE lid = ?
    `)
    db.transaction(() => {
        for (const row of rows) {
            revokeLicense(db, { lid: row.lid, reason, org: row.org, tier: row.tier, expiresAt: row.expires_at })
            mark.run(reason, row.lid)
        }
    })()
    return rows.length
}
