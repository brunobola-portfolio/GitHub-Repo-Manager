// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.

import logger from './logger.js'
import { stripUntilStable } from './strip-until-stable.js'
import db from '../db.js'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Retry policy for the initial send: up to 3 attempts with exponential
// backoff (1 s, 3 s, 9 s + up to 250 ms jitter). Only 5xx and network errors
// are retried; 4xx is treated as un-retryable (bad input).
const INITIAL_ATTEMPTS = 3
// Tests can override the base delay to keep retry tests fast. In production
// the env var is unset → default 1 000 ms → 1 s / 3 s / 9 s backoff.
const BASE_DELAY_MS = Number.parseInt(process.env.EMAIL_RETRY_BASE_DELAY_MS ?? '1000', 10)

/**
 * Derive a plain-text fallback from an HTML body.
 * Strips tags, collapses whitespace, and trims.
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
    // Tags come off to a fixed point, like every other stripper here: what a
    // single `replace` leaves behind can match the same rule again, and this
    // one runs over notification bodies that carry repository content.
    const stripped = stripUntilStable(String(html ?? ''), (v) => v
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')).value

    return stripped
        // '&amp;' decodes LAST. Decoding it first turns '&amp;lt;' into '&lt;'
        // and then into '<' — the source text said "&lt;", and the reader of
        // the plain-text part would see a tag that was never there.
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/**
 * Sleep helper that respects vitest fake timers (which advance automatically
 * when `shouldAdvanceTime: true`).
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Format a JS Date as SQLite-compatible `YYYY-MM-DD HH:MM:SS` (UTC).
 * Matches what `datetime('now')` returns so lexicographic compares work.
 */
export function toSqliteDatetime(date) {
    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
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
 *
 * Returns `{ ok, id? }` on success. On failure returns
 * `{ ok: false, error, retryable }` — `retryable=true` for 5xx + network,
 * `false` for 4xx and config errors.
 */
async function sendResend({ to, subject, html, text }) {
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.EMAIL_FROM

    if (!apiKey) {
        logger.error('[email:resend] RESEND_API_KEY is not set')
        return { ok: false, error: 'RESEND_API_KEY not configured', retryable: false }
    }
    if (!from) {
        logger.error('[email:resend] EMAIL_FROM is not set')
        return { ok: false, error: 'EMAIL_FROM not configured', retryable: false }
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
        // Network errors are transient — retry.
        return { ok: false, error: err.message, retryable: true }
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
        // 5xx → retryable; 4xx → permanent (bad from-addr, invalid template, etc.).
        const retryable = response.status >= 500 && response.status < 600
        return { ok: false, error: errorMessage, retryable, status: response.status }
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
 * Pick the configured provider's raw send function. Exposed for the retry
 * worker so it can re-drive the same adapter without re-validating inputs.
 */
export function resolveProvider() {
    const provider = process.env.EMAIL_PROVIDER ?? 'console'
    if (provider === 'resend') return sendResend
    return sendConsole
}

/**
 * Run a single send attempt against the configured provider.
 * Shared between `sendEmail` and the retry worker.
 */
export async function attemptSendOnce({ to, subject, html, text }) {
    const providerFn = resolveProvider()
    return providerFn({ to, subject, html, text })
}

/**
 * Insert a failed email into the dead-letter queue.
 *
 * @returns {number|null} the new row id, or null if the insert failed.
 */
function insertDeadLetter({ to, subject, html, text, context, attempts, lastError, nextRetryAt }) {
    try {
        const info = db.prepare(`
            INSERT INTO email_dead_letter
                (to_address, subject, body_html, body_text, context_json, attempts, last_error, next_retry_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            to,
            subject,
            html ?? null,
            text ?? null,
            context ? JSON.stringify(context) : null,
            attempts,
            lastError ?? null,
            nextRetryAt,
        )
        return Number(info.lastInsertRowid)
    } catch (err) {
        logger.error({ err, to, subject }, '[email] failed to insert into dead-letter queue')
        return null
    }
}

/**
 * Send an email through the configured provider, with exponential-backoff
 * retry and dead-letter fallback.
 *
 * Retry policy: up to 3 attempts with delays 1 s → 3 s → 9 s (+ jitter).
 * Only 5xx and network errors retry; 4xx fails fast.
 *
 * On final failure after all 3 attempts, inserts into `email_dead_letter`
 * so a background worker can keep trying; returns `{ ok: false, dlqId, error }`.
 *
 * @param {object} opts
 * @param {string} opts.to         — recipient email
 * @param {string} opts.subject
 * @param {string} opts.html       — HTML body
 * @param {string} [opts.text]     — plain-text fallback; auto-derived from html if omitted
 * @param {object} [opts.context]  — opaque metadata persisted in DLQ (license_id, user_id, etc.)
 * @returns {Promise<{ ok: boolean, id?: string, error?: string, dlqId?: number }>}
 */
export async function sendEmail({ to, subject, html, text, context } = {}) {
    // Validate recipient
    if (!to || !EMAIL_REGEX.test(to)) {
        logger.warn({ to }, '[email] invalid recipient address')
        return { ok: false, error: 'invalid recipient' }
    }

    const plainText = text ?? htmlToText(html ?? '')
    const provider = process.env.EMAIL_PROVIDER ?? 'console'

    // The console adapter never "fails" — short-circuit the retry machinery.
    if (provider !== 'resend') {
        return sendConsole({ to, subject, html })
    }

    let lastResult = null
    for (let attempt = 1; attempt <= INITIAL_ATTEMPTS; attempt++) {
        lastResult = await sendResend({ to, subject, html, text: plainText })

        if (lastResult.ok) {
            return { ok: true, id: lastResult.id }
        }

        if (!lastResult.retryable) {
            // 4xx or config error — do not retry, do not DLQ (un-retryable).
            return { ok: false, error: lastResult.error }
        }

        // Retryable failure — back off before the next attempt.
        if (attempt < INITIAL_ATTEMPTS) {
            const backoff = BASE_DELAY_MS * Math.pow(3, attempt - 1)
            const jitter = Math.floor(Math.random() * 250)
            logger.warn(
                { to, subject, attempt, nextDelayMs: backoff + jitter, error: lastResult.error },
                '[email] transient failure — retrying'
            )
            await delay(backoff + jitter)
        }
    }

    // All 3 attempts exhausted with retryable errors — push into DLQ.
    const nextRetryAt = toSqliteDatetime(new Date(Date.now() + 5 * 60 * 1000))
    const dlqId = insertDeadLetter({
        to,
        subject,
        html,
        text: plainText,
        context,
        attempts: INITIAL_ATTEMPTS,
        lastError: lastResult?.error ?? 'unknown',
        nextRetryAt,
    })

    logger.error(
        { to, subject, attempts: INITIAL_ATTEMPTS, dlqId, error: lastResult?.error },
        '[email] giving up after initial retries — inserted into dead-letter queue'
    )

    return {
        ok: false,
        error: lastResult?.error ?? 'send failed',
        ...(dlqId != null ? { dlqId } : {}),
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
