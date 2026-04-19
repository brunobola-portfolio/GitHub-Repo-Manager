// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

import logger from './logger.js'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Derive a plain-text fallback from an HTML body.
 * Strips tags, collapses whitespace, and trims.
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/**
 * Console adapter — logs that an email would have been sent.
 * Does NOT log the body (may contain license keys or sensitive data).
 */
async function sendConsole({ to, subject, html }) {
    logger.info(
        { to, subject, bodyLength: html?.length ?? 0 },
        '[email:dev] would send'
    )
    return { ok: true }
}

/**
 * Resend adapter — POSTs to the Resend API using bare fetch.
 */
async function sendResend({ to, subject, html, text }) {
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.EMAIL_FROM

    if (!apiKey) {
        logger.error('[email:resend] RESEND_API_KEY is not set')
        return { ok: false, error: 'RESEND_API_KEY not configured' }
    }
    if (!from) {
        logger.error('[email:resend] EMAIL_FROM is not set')
        return { ok: false, error: 'EMAIL_FROM not configured' }
    }

    let response
    try {
        response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from, to, subject, html, text }),
        })
    } catch (err) {
        logger.error({ err }, '[email:resend] network error')
        return { ok: false, error: err.message }
    }

    if (!response.ok) {
        let errorBody
        try {
            errorBody = await response.json()
        } catch {
            errorBody = { message: response.statusText }
        }
        const errorMessage = errorBody?.message || errorBody?.error || `HTTP ${response.status}`
        logger.error({ status: response.status, error: errorMessage }, '[email:resend] delivery failed')
        return { ok: false, error: errorMessage }
    }

    let data
    try {
        data = await response.json()
    } catch {
        data = {}
    }

    return { ok: true, id: data.id }
}

/**
 * Send an email through the configured provider.
 *
 * Selects adapter by EMAIL_PROVIDER env var:
 *   - 'console' (default) — logs subject+to to stdout. Does NOT log the body.
 *   - 'resend' — POSTs to https://api.resend.com/emails via bare fetch.
 *     Requires RESEND_API_KEY + EMAIL_FROM env vars.
 *
 * @param {object} opts
 * @param {string} opts.to         — recipient email
 * @param {string} opts.subject
 * @param {string} opts.html       — HTML body
 * @param {string} [opts.text]     — plain-text fallback; auto-derived from html if omitted
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export async function sendEmail({ to, subject, html, text }) {
    // Validate recipient
    if (!to || !EMAIL_REGEX.test(to)) {
        logger.warn({ to }, '[email] invalid recipient address')
        return { ok: false, error: 'invalid recipient' }
    }

    const plainText = text ?? htmlToText(html ?? '')
    const provider = process.env.EMAIL_PROVIDER ?? 'console'

    switch (provider) {
        case 'resend':
            return sendResend({ to, subject, html, text: plainText })
        case 'console':
        default:
            return sendConsole({ to, subject, html })
    }
}

/**
 * Whether email is currently configured to actually deliver.
 * Returns false when provider is 'console' — caller can fall back to
 * on-screen reveal of the license key in that case.
 *
 * @returns {boolean}
 */
export function isEmailDeliveryConfigured() {
    return process.env.EMAIL_PROVIDER === 'resend'
}
