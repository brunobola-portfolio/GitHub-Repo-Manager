/*
 * GitHub Repo Manager
 * Shared error utilities
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { ApiError, ErrorType } from './api'

/**
 * Map server-returned `reason` values from bulk confirmation errors to
 * user-friendly messages.
 */
const BULK_REASON_MESSAGES = {
  'repos-mismatch': 'The request was modified after confirmation; please try again.',
  'extra-mismatch': 'The request was modified after confirmation; please try again.',
  'expired': 'Confirmation expired; please try again.',
}

/**
 * Get user-friendly error info based on error type
 */
export function getErrorInfo(error) {
    if (error instanceof ApiError) {
        // Use server-provided message if more specific than the generic one
        const serverMessage = error.data?.error || error.data?.message
        const detailMessages = error.data?.details?.map(d => d.message).join('; ')

        // Also extract per-repo errors from bulk operation results
        const bulkResults = error.data?.results
        const failedResults = Array.isArray(bulkResults)
            ? bulkResults.filter(r => r && r.success === false)
            : []
        const bulkDetails = failedResults.length > 0
            ? failedResults.map(r => ({ field: r.repo, message: r.error || 'Operation failed' }))
            : null

        const specificMessage = detailMessages || serverMessage

        return {
            type: error.type,
            message: specificMessage || error.userMessage,
            details: error.data?.details || bulkDetails || null,
            isRetryable: error.isRetryable,
            status: error.status
        }
    }

    if (!navigator.onLine) {
        return {
            type: ErrorType.OFFLINE,
            message: 'You appear to be offline. Please check your connection.',
            isRetryable: true,
            status: null
        }
    }

    // Errors thrown by bulkExecuteWithConfirmation carry `.status` and `.reason`
    if (error?.status != null) {
        const friendlyMessage = BULK_REASON_MESSAGES[error.reason]
            || error?.message
            || 'An unexpected error occurred.'
        return {
            type: error.status === 403 ? ErrorType.AUTHORIZATION : ErrorType.UNKNOWN,
            message: friendlyMessage,
            isRetryable: false,
            status: error.status,
        }
    }

    return {
        type: ErrorType.UNKNOWN,
        message: error?.message || 'An unexpected error occurred.',
        isRetryable: true,
        status: null
    }
}

// ---------------------------------------------------------------------------
// formatUserError — uniform user-facing error shape
// ---------------------------------------------------------------------------
//
// The historical getErrorInfo() above maps backend ApiErrors to internal
// shapes. formatUserError() is the *user-facing* wrapper: it returns a
// presentation object { title, body, action?, code, raw: null } that:
//   - never includes a stack trace, error.message, or any raw backend string
//   - routes known error codes to a fixed CTA per code
//   - falls back to a generic "Something went wrong" with a retry CTA
//
// Callers should pass the helper to a toast/banner component instead of
// rendering err.message directly. See toast.errorFromException for the
// reference integration.

// Action shape: `{ label, kind, type?, settingsTab?, target? }`
//   - `kind`: legacy field consumed by toast/banner integrations
//   - `type`: canonical AIErrorState dispatcher key — one of
//             'configure' | 'upgrade' | 'retry' | 'dismiss'
//   - `settingsTab`: hint for 'open-settings' kind
//   - `target`: optional CustomEvent detail target (route)
//
// Both `kind` and `type` are emitted for every entry so the historical
// toast helpers AND the new <AIErrorState /> component pull from one table.
const KNOWN_ERRORS = {
    NETWORK_ERROR: {
        title: 'Could not reach the server',
        body: 'Check your connection and try again.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    UNAUTHORIZED: {
        title: 'Session expired',
        body: 'Please sign in again to continue.',
        action: { label: 'Sign in', kind: 'reauth', type: 'configure' },
    },
    AI_KEY_INVALID: {
        title: 'AI key rejected',
        body: 'Your API key was not accepted by the provider.',
        action: { label: 'Update key', kind: 'open-settings', type: 'configure', settingsTab: 'ai' },
    },
    AI_NOT_CONFIGURED: {
        title: 'AI is not configured',
        body: 'Configure a Gemini API key in Settings → AI to use this feature.',
        action: { label: 'Open Settings', kind: 'open-settings', type: 'configure', settingsTab: 'ai' },
    },
    TIER_REQUIRED_PRO: {
        title: 'Pro feature',
        body: 'This feature is part of the Pro plan.',
        action: { label: 'See plans', kind: 'open-pricing', type: 'upgrade' },
    },
    TIER_REQUIRED_ENTERPRISE: {
        title: 'Enterprise feature',
        body: 'This feature is part of the Enterprise plan.',
        action: { label: 'Contact sales', kind: 'open-pricing', type: 'upgrade' },
    },
    QUOTA_EXCEEDED: {
        title: 'Quota exceeded',
        body: 'You have used your monthly allowance for this feature.',
        action: { label: 'See options', kind: 'open-quota', type: 'upgrade' },
    },
    // -----------------------------------------------------------------
    // Server AI vocabulary — every code emitted by handleAIError plus
    // the route-specific codes thrown around the AI surface area.
    // Keep this list in sync with server/routes/ai/shared.js and the
    // adjacent route files (deep-review.js, core.js, ...).
    // -----------------------------------------------------------------
    INVALID_API_KEY: {
        title: 'AI key rejected',
        body: 'The provider rejected the configured API key. Update it in Settings → AI.',
        action: { label: 'Update key', kind: 'open-settings', type: 'configure', settingsTab: 'ai' },
    },
    NO_AI_PROVIDER: {
        title: 'No AI provider configured',
        body: 'Set up a provider API key in Settings → AI to use this feature.',
        action: { label: 'Open Settings', kind: 'open-settings', type: 'configure', settingsTab: 'ai' },
    },
    AI_DISABLED: {
        title: 'AI is disabled on this server',
        body: 'The administrator has turned off AI features.',
        action: { label: 'Dismiss', kind: 'dismiss', type: 'dismiss' },
    },
    RATE_LIMITED: {
        title: 'AI provider is rate-limited',
        body: 'Too many requests in a short window. Try again shortly.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    AI_TIMEOUT: {
        title: 'AI provider timed out',
        body: 'The request did not complete in time. Try again.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    AI_NETWORK_ERROR: {
        title: 'Could not reach the AI provider',
        body: 'A network or upstream issue blocked the request.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    AI_OVERLOADED: {
        title: 'AI provider is overloaded',
        body: 'The model is briefly unavailable. Try again in a moment.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    AI_REQUEST_FAILED: {
        title: 'AI request failed',
        body: 'The provider returned an error. Try again or check your provider status.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    AI_PARSE_ERROR: {
        title: 'AI returned an invalid response',
        body: 'The model responded but the format could not be parsed. Retry to get a fresh response.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    MODEL_NOT_FOUND: {
        title: 'AI model unavailable',
        body: 'The configured model is not available. Verify the model setting in Settings → AI.',
        action: { label: 'Open Settings', kind: 'open-settings', type: 'configure', settingsTab: 'ai' },
    },
    PRESET_NOT_FOUND: {
        title: 'Prompt preset not found',
        body: 'The selected prompt preset is no longer available. Pick a different one and retry.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    GITHUB_FETCH_FAILED: {
        title: 'Could not load PR data from GitHub',
        body: 'GitHub did not return the PR contents. Check your connection and retry.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    PUBLISH_FAILED: {
        title: 'Could not publish to GitHub',
        body: 'The review could not be posted. Try again — if it keeps failing the publish was queued and will retry automatically.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    AI_PROVIDER_UNAVAILABLE: {
        title: 'AI provider unavailable',
        body: 'The provider could not be reached. Try again shortly.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    AI_PROVIDER_ERROR: {
        title: 'AI provider error',
        body: 'The provider returned an unexpected error.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    AI_INVALID_RESPONSE: {
        title: 'AI returned an invalid response',
        body: 'The model output was not in the expected shape. Retry to get a fresh response.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    PROVIDER_LOOKUP_FAILED: {
        title: 'Could not load AI configuration',
        body: 'Failed to resolve your AI provider settings. Check Settings → AI.',
        action: { label: 'Open Settings', kind: 'open-settings', type: 'configure', settingsTab: 'ai' },
    },
    AI_REVIEW_DISABLED: {
        title: 'AI review is disabled',
        body: 'This AI feature has been disabled by the administrator.',
        action: { label: 'Dismiss', kind: 'dismiss', type: 'dismiss' },
    },
    GITHUB_PRO_REQUIRED: {
        title: 'Branch protection requires GitHub Pro',
        body: 'On the free plan, branch protection rules are only available on public repositories. Upgrade to GitHub Pro, or make this repo public, to enable protection.',
        action: { label: 'Upgrade', kind: 'open-pricing', type: 'upgrade' },
    },
}

const FALLBACK = {
    title: 'Something went wrong',
    body: 'Please try again. If the problem persists, contact bruno@bolalabs.pt.',
    action: { label: 'Retry', kind: 'retry', type: 'retry' },
}

function pickCode(err, ctx) {
    return err?.code
        || err?.data?.code
        || err?.response?.data?.code
        || ctx?.code
        || null
}

// Server-side AI error codes are emitted in lowercase (ai_quota_exceeded,
// ai_rate_limited, …) by `mapAIErrorToResponse`; the client KNOWN_ERRORS
// table is keyed by the canonical UPPERCASE forms shared with handleAIError.
// Map the lowercase aliases here so callers don't need to know which codepath
// produced the error envelope.
const CODE_ALIASES = {
    ai_quota_exceeded: 'QUOTA_EXCEEDED',
    ai_rate_limited: 'RATE_LIMITED',
    ai_overload: 'AI_OVERLOADED',
    ai_timeout: 'AI_TIMEOUT',
    ai_auth: 'INVALID_API_KEY',
    ai_network: 'AI_NETWORK_ERROR',
    ai_not_configured: 'AI_NOT_CONFIGURED',
    ai_invalid_response: 'AI_INVALID_RESPONSE',
    ai_provider_unavailable: 'AI_PROVIDER_UNAVAILABLE',
    ai_provider_error: 'AI_PROVIDER_ERROR',
    ai_request_failed: 'AI_REQUEST_FAILED',
    ai_disabled: 'AI_DISABLED',
}

function pickRetryAfterSec(err) {
    const v = err?.retryAfterSec
        ?? err?.data?.retryAfterSec
        ?? err?.response?.data?.retryAfterSec
        ?? null
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null
}

function pickRawMessage(err) {
    return err?.data?.error
        || err?.response?.data?.error
        || (typeof err?.message === 'string' ? err.message : '')
        || ''
}

function pickStatus(err) {
    return err?.status ?? err?.response?.status ?? null
}

export function formatUserError(err, ctx = {}) {
    if (!err) return { ...FALLBACK, code: null, raw: null }

    const rawCode = pickCode(err, ctx)
    const code = rawCode && (KNOWN_ERRORS[rawCode] ? rawCode : CODE_ALIASES[rawCode] || null)
    const retryAfterSec = pickRetryAfterSec(err)

    if (code && KNOWN_ERRORS[code]) {
        const base = KNOWN_ERRORS[code]
        // Rate-limit envelopes carry a server-supplied retry hint — surface it
        // in the body so the user sees a concrete countdown instead of the
        // generic "try again shortly" copy.
        if (code === 'RATE_LIMITED' && retryAfterSec) {
            return {
                ...base,
                body: `Too many requests in a short window. Retry in ${retryAfterSec}s.`,
                code,
                raw: null,
            }
        }
        return { ...base, code, raw: null }
    }

    if (err.name === 'TypeError' && /fetch|network/i.test(err.message || '')) {
        return { ...KNOWN_ERRORS.NETWORK_ERROR, code: 'NETWORK_ERROR', raw: null }
    }

    const status = pickStatus(err)
    if (status === 401) {
        return { ...KNOWN_ERRORS.UNAUTHORIZED, code: 'UNAUTHORIZED', raw: null }
    }

    // Pre-machine-code legacy server responses leak the raw provider string.
    // Detect quota/rate-limit keywords in the body so we never paste the
    // full Google RPC dump into the UI.
    const raw = pickRawMessage(err)
    if (/quota/i.test(raw)) {
        return { ...KNOWN_ERRORS.QUOTA_EXCEEDED, code: 'QUOTA_EXCEEDED', raw: null }
    }
    if (status === 429 || /rate.?limit/i.test(raw)) {
        const base = KNOWN_ERRORS.RATE_LIMITED
        if (retryAfterSec) {
            return { ...base, body: `Too many requests in a short window. Retry in ${retryAfterSec}s.`, code: 'RATE_LIMITED', raw: null }
        }
        return { ...base, code: 'RATE_LIMITED', raw: null }
    }

    if (import.meta.env?.DEV) {

        console.warn('[formatUserError] unmapped error:', err)
    }
    return {
        ...FALLBACK,
        title: ctx.fallbackTitle || FALLBACK.title,
        code: null,
        raw: null,
    }
}
