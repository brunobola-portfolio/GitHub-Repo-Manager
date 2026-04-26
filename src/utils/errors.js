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

const KNOWN_ERRORS = {
    NETWORK_ERROR: {
        title: 'Could not reach the server',
        body: 'Check your connection and try again.',
        action: { label: 'Retry', kind: 'retry' },
    },
    UNAUTHORIZED: {
        title: 'Session expired',
        body: 'Please sign in again to continue.',
        action: { label: 'Sign in', kind: 'reauth' },
    },
    AI_KEY_INVALID: {
        title: 'AI key rejected',
        body: 'Your API key was not accepted by the provider.',
        action: { label: 'Update key', kind: 'open-settings', settingsTab: 'ai' },
    },
    AI_NOT_CONFIGURED: {
        title: 'AI is not configured',
        body: 'Configure a Gemini API key in Settings → AI to use this feature.',
        action: { label: 'Open Settings', kind: 'open-settings', settingsTab: 'ai' },
    },
    TIER_REQUIRED_PRO: {
        title: 'Pro feature',
        body: 'This feature is part of the Pro plan.',
        action: { label: 'See plans', kind: 'open-pricing' },
    },
    TIER_REQUIRED_ENTERPRISE: {
        title: 'Enterprise feature',
        body: 'This feature is part of the Enterprise plan.',
        action: { label: 'Contact sales', kind: 'open-pricing' },
    },
    QUOTA_EXCEEDED: {
        title: 'Quota reached',
        body: 'You have used your monthly allowance for this feature.',
        action: { label: 'See options', kind: 'open-quota' },
    },
}

const FALLBACK = {
    title: 'Something went wrong',
    body: 'Please try again. If the problem persists, contact bruno@bolalabs.pt.',
    action: { label: 'Retry', kind: 'retry' },
}

function pickCode(err, ctx) {
    return err?.code || err?.response?.data?.code || ctx?.code || null
}

export function formatUserError(err, ctx = {}) {
    if (!err) return { ...FALLBACK, code: null, raw: null }

    const code = pickCode(err, ctx)
    if (code && KNOWN_ERRORS[code]) {
        return { ...KNOWN_ERRORS[code], code, raw: null }
    }

    if (err.name === 'TypeError' && /fetch|network/i.test(err.message || '')) {
        return { ...KNOWN_ERRORS.NETWORK_ERROR, code: 'NETWORK_ERROR', raw: null }
    }

    if (err.status === 401 || err.response?.status === 401) {
        return { ...KNOWN_ERRORS.UNAUTHORIZED, code: 'UNAUTHORIZED', raw: null }
    }

    if (import.meta.env?.DEV) {
         
        console.warn('[formatUserError] unmapped error:', err)
    }
    return { ...FALLBACK, code: null, raw: null }
}
