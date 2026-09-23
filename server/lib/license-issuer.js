// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.

import { generateLicenseKey, addCalendarMonths } from './license.js'
import { isEmailDeliveryConfigured, sendEmail } from './email.js'
import db from '../db.js'
import logger from './logger.js'

/**
 * Describe a license's actual validity window in plain language, matching
 * whatever `months` was really signed into the JWT (see generateLicenseKey).
 * Both monthly and yearly subs get a fresh key reissued automatically on
 * each paid renewal invoice (stripe-webhooks.js `invoice.paid` /
 * billing_reason=subscription_cycle) — monthly gets a 1-month key, yearly a
 * 12-month key. Never say "cannot be reissued" — that used to be true for
 * every plan when this always said 12 months regardless of what was
 * actually paid for; it no longer is for either billing period.
 *
 * @param {number} months
 * @returns {string}
 */
function describeLicenseValidity(months) {
    if (months >= 12) {
        return `This key is valid for ${months} months, matching your annual billing cycle. Renewing next year issues a fresh key automatically.`
    }
    if (months === 1) {
        return `This key is valid for 1 month, matching your monthly billing cycle. While your subscription stays active, we email you a fresh key automatically at the start of every billing period — no action needed.`
    }
    return `This key is valid for ${months} month${months === 1 ? '' : 's'}.`
}

/**
 * Build the HTML email body for a license delivery.
 *
 * @param {object} opts
 * @param {string} opts.tier
 * @param {string} opts.licenseKey
 * @param {number} opts.months
 * @returns {string} HTML
 */
function buildLicenseEmailHtml({ tier, licenseKey, months }) {
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1)
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; line-height: 1.6; color: #222; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2>Your GitHub Repo Manager license key</h2>
  <p>Thank you for subscribing to the <strong>${tierLabel}</strong> plan.</p>
  <p>Your license key is:</p>
  <pre style="background: #f4f4f4; border: 1px solid #ddd; border-radius: 4px; padding: 16px; font-family: monospace; font-size: 14px; word-break: break-all;">${licenseKey}</pre>
  <h3>Do I need to activate it?</h3>
  <p><strong>Using the hosted app?</strong> No. Your ${tierLabel} plan is already active on your account — there is nothing to paste.</p>
  <p><strong>Running your own install?</strong> An administrator of that install opens <strong>Settings → License &amp; Plan → Activate</strong> and pastes the key. It applies to every account on the install.</p>
  <p>${describeLicenseValidity(months)}</p>
  <p>Keep this key safe and treat it like a password. Cancelling your subscription does not switch it off — it keeps working to the end of the period you paid for.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="font-size: 13px; color: #666;">
    Need help? Contact us at
    <a href="mailto:bruno@bolalabs.pt">bruno@bolalabs.pt</a>.
  </p>
</body>
</html>`
}

/**
 * Build the plain-text fallback for a license delivery email.
 *
 * @param {object} opts
 * @param {string} opts.tier
 * @param {string} opts.licenseKey
 * @param {number} opts.months
 * @returns {string}
 */
function buildLicenseEmailText({ tier, licenseKey, months }) {
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1)
    return `Your GitHub Repo Manager license key
======================================

Thank you for subscribing to the ${tierLabel} plan.

Your license key is:

${licenseKey}

Do I need to activate it?
------------------------
Using the hosted app? No. Your ${tierLabel} plan is already active on your account.
Running your own install? An administrator of that install opens
Settings -> License & Plan -> Activate and pastes the key. It applies to
every account on the install.

${describeLicenseValidity(months)}

Keep this key safe and treat it like a password. Cancelling your subscription
does not switch it off — it keeps working to the end of the period you paid for.

Need help? Contact us at bruno@bolalabs.pt`
}

/**
 * Issue a license key on behalf of a checkout session AND email it to
 * the recipient. Called from the Stripe webhook.
 *
 * Idempotent per stripe_session_id: if a row already exists for this
 * session, the existing license key is returned without sending another email.
 *
 * @param {object} opts
 * @param {number} opts.userId
 * @param {string} opts.email
 * @param {string} opts.tier           — 'pro' | 'enterprise'
 * @param {number} [opts.seats=1]
 * @param {number} [opts.months=1] — 1 for a monthly billing period, 12 for
 *   yearly (see stripe-webhooks.js checkout.session.completed / invoice.paid).
 * @param {string} opts.stripeSubscriptionId
 * @param {string} opts.stripeSessionId
 * @returns {Promise<{ licenseKey: string|null, emailDelivered: boolean }>}
 */
export async function issueLicenseForCheckout(opts) {
    const {
        userId,
        email,
        tier,
        seats = 1,
        months = 1,
        stripeSubscriptionId,
        stripeSessionId,
    } = opts

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

    // Generate the signed license key
    let licenseKey
    try {
        licenseKey = await generateLicenseKey(
            { email, tier, seats, months },
            privateKeyPem
        )
    } catch (err) {
        logger.error({ err, stripeSessionId }, 'license-issuer: key generation failed')
        return { licenseKey: null, emailDelivered: false }
    }

    // Compute expiry date for storage using the same calendar-month
    // arithmetic as the signed JWT's `exp` (license.js) — otherwise this
    // stored record would drift from what the key actually enforces.
    const expiresAt = months > 0
        ? new Date(addCalendarMonths(Math.floor(Date.now() / 1000), months) * 1000).toISOString()
        : null

    // Persist first (so a partial failure still has the record)
    try {
        db.prepare(`
            INSERT OR IGNORE INTO issued_licenses
                (user_id, stripe_subscription_id, stripe_session_id, tier, license_key, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, stripeSubscriptionId, stripeSessionId, tier, licenseKey, expiresAt)
    } catch (err) {
        logger.error({ err, stripeSessionId }, 'license-issuer: failed to persist issued license')
        return { licenseKey: null, emailDelivered: false }
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
    try {
        const result = await sendEmail({
            to: email,
            subject: `Your GitHub Repo Manager license — ${tier} plan`,
            html: buildLicenseEmailHtml({ tier, licenseKey, months }),
            text: buildLicenseEmailText({ tier, licenseKey, months }),
        })

        if (result.ok) {
            emailDelivered = true
            db.prepare(`
                UPDATE issued_licenses
                SET email_delivered = 1, email_delivered_at = datetime('now')
                WHERE stripe_session_id = ?
            `).run(stripeSessionId)
        } else {
            logger.warn({ stripeSessionId, error: result.error }, 'license-issuer: email delivery failed; license persisted with email_delivered=0')
        }
    } catch (err) {
        logger.error({ err, stripeSessionId }, 'license-issuer: unexpected error during email send')
    }

    return { licenseKey, emailDelivered }
}
