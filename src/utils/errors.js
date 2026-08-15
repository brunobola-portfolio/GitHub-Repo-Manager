/*
 * GitHub Repo Manager
 * Shared error utilities
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the Apache License 2.0 (SPDX: Apache-2.0). See LICENSE in the project root.
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

    // Client-side selection guard (repoMutations). Retrying without changing
    // the selection fails identically, so this must not be offered as retryable
    // — the user has to deselect, and the message already says by how much.
    if (error?.code === 'BULK_SELECTION_TOO_LARGE') {
        return {
            type: ErrorType.VALIDATION,
            message: error.message,
            isRetryable: false,
            status: null,
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
        body: 'Configure an AI provider key in Settings → AI to use this feature.',
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
    PAYLOAD_TOO_LARGE: {
        title: 'This PR is too large to review',
        body: 'The diff exceeds the size we can analyze in one pass. Try a smaller pull request or review fewer files at a time.',
        action: { label: 'Dismiss', kind: 'dismiss', type: 'dismiss' },
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
    // A user-initiated cancel is not a failure. It previously aliased to
    // AI_REQUEST_FAILED, so clicking Cancel reported that the provider errored.
    AI_CANCELED: {
        title: 'Generation canceled',
        body: 'You stopped this request before it finished.',
        action: { label: 'Try again', kind: 'retry', type: 'retry' },
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
    // AI Image Generator (Wave 6c / R5, server/routes/ai/images.js).
    PROVIDER_NO_IMAGE_SUPPORT: {
        title: 'Image generation not available',
        body: 'Your current AI provider doesn’t support image output. Switch to a provider that does (Gemini, OpenAI, or OpenRouter) in Settings → AI.',
        action: { label: 'Open AI Settings', kind: 'open-settings', type: 'configure', settingsTab: 'ai' },
    },
    IMAGE_REFUSAL: {
        title: 'Image generation declined',
        body: 'The AI provider declined to generate this image. Try rephrasing the style hint.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    IMAGE_PRICING_UNAVAILABLE: {
        title: 'Image pricing not configured',
        body: 'This provider/model combination isn’t priced yet, so the request was declined rather than billed unpredictably. Try a different provider in Settings → AI.',
        action: { label: 'Open AI Settings', kind: 'open-settings', type: 'configure', settingsTab: 'ai' },
    },
    // Emitted by handleAIError (server/routes/ai/shared.js) for EVERY AI
    // route, not just image generation — added here because none of the
    // AI surfaces had a specific mapping for it before (it fell through to
    // the generic "Something went wrong" fallback).
    AI_SPEND_CAP_REACHED: {
        title: 'Monthly AI budget reached',
        body: 'You have used your monthly AI spending allowance. It resets next month, or an admin can raise the cap.',
        action: { label: 'Dismiss', kind: 'dismiss', type: 'dismiss' },
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
    AI_SUMMARY_FAILED: {
        title: 'AI summary unavailable',
        body: 'The summary could not be generated. Try again — if it keeps failing, check your AI provider in Settings → AI.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    INVALID_HOST: {
        title: 'Source host not allowed',
        body: 'The Azure DevOps / TFS server isn’t on the allowlist. An admin must add it under Settings → Azure host allowlist before the migration can run.',
        action: { label: 'Open Settings', kind: 'open-settings', type: 'configure', settingsTab: 'azure-hosts' },
    },
    UPGRADE_REQUIRED: {
        title: 'Pro plan required',
        body: 'Real migration execution is part of the Pro plan. Free accounts can still create and run dry-run plans.',
        action: { label: 'See plans', kind: 'open-pricing', type: 'upgrade' },
    },
    // Migration preflight: the execute/resume/retry routes return a 422 with
    // this code when a required CLI (TFVC client, git-tfs, Git LFS) is missing
    // on the migration server. The inline banner shows the specific tool +
    // fix (surfaced via migrationApi); this toast routes the user to the
    // Migration Tooling settings tab where the environment doctor lives.
    ENV_TOOL_MISSING: {
        title: 'Migration tool missing on the server',
        body: 'A command-line tool this migration needs (such as the TFVC client or Git LFS) isn’t installed on the migration server. Install it — or run the environment doctor — then retry. The inline error names the exact tool.',
        action: { label: 'Check environment', kind: 'open-settings', type: 'configure', settingsTab: 'env-tooling' },
    },
    // --- Status-ladder entries -------------------------------------------
    // Reached when a response carries a status we understand but a code we
    // don't. Before these existed, every 400/403/404/409 rendered FALLBACK —
    // "Something went wrong… contact bruno@bolalabs.pt" with a Retry button —
    // which for a deterministic 4xx is both wrong about the cause and offers
    // an action that cannot possibly work.
    BAD_REQUEST: {
        title: 'We couldn’t send that request',
        body: 'The app built a request the server rejected. Retrying won’t help — reload the page, and if it keeps happening this is a bug worth reporting.',
        action: { label: 'Dismiss', kind: 'dismiss', type: 'dismiss' },
    },
    FORBIDDEN: {
        title: 'You don’t have access to this',
        body: 'Your account or token lacks the permission this action needs. Check that your GitHub token still has the required scopes.',
        action: { label: 'Dismiss', kind: 'dismiss', type: 'dismiss' },
    },
    NOT_FOUND: {
        title: 'Not found',
        body: 'This no longer exists, or you don’t have access to it. It may have been renamed, moved, or deleted.',
        action: { label: 'Dismiss', kind: 'dismiss', type: 'dismiss' },
    },
    CONFLICT: {
        title: 'Already done',
        body: 'This changed since you opened it — it may already be published, or someone else got there first. Reload to see the current state.',
        action: { label: 'Dismiss', kind: 'dismiss', type: 'dismiss' },
    },
    SERVER_ERROR: {
        title: 'The server had a problem',
        body: 'Something failed on our side, not yours. This one is worth retrying.',
        action: { label: 'Retry', kind: 'retry', type: 'retry' },
    },
    // Specific 4xx cases whose generic ladder copy would lose real information.
    SESSION_REFRESHED: {
        title: 'Your session was refreshed',
        body: 'A security token expired while the page was open. Reload and your action will go through.',
        action: { label: 'Reload', kind: 'retry', type: 'retry' },
    },
    AI_COST_CAP_REACHED: {
        title: 'Monthly AI budget reached',
        body: 'You’ve hit the AI spend cap for this month. This resets at the start of next month — it is not a temporary rate limit.',
        action: { label: 'See options', kind: 'open-quota', type: 'upgrade' },
    },
}

const FALLBACK = {
    title: 'Something went wrong',
    body: 'Please try again. If the problem persists, contact bruno@bolalabs.pt.',
    action: { label: 'Retry', kind: 'retry', type: 'retry' },
}

// A status we understand but a code we don't. Ordered least-to-most specific by
// the caller: a mapped code always wins over this table.
const STATUS_FALLBACKS = {
    400: 'BAD_REQUEST',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'BAD_REQUEST',
    500: 'SERVER_ERROR',
    502: 'SERVER_ERROR',
    503: 'SERVER_ERROR',
    504: 'SERVER_ERROR',
}

function pickCode(err, ctx) {
    // Some server routes (notably the migration plan endpoints) put the
    // machine code under `error` rather than `code` — e.g. `{ error:
    // 'invalid_host', message: '...' }`. Fall back to that so the toast
    // maps to a sensible KNOWN_ERRORS entry instead of the generic fallback.
    return err?.code
        || err?.data?.code
        || err?.response?.data?.code
        || err?.data?.error
        || err?.response?.data?.error
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
    ai_model_not_found: 'MODEL_NOT_FOUND',
    provider_no_image_support: 'PROVIDER_NO_IMAGE_SUPPORT',
    image_pricing_unavailable: 'IMAGE_PRICING_UNAVAILABLE',
    ai_canceled: 'AI_CANCELED',
    ai_summary_failed: 'AI_SUMMARY_FAILED',
    // Non-AI server errors that follow the `{ error: '<snake_code>' }` shape.
    invalid_host: 'INVALID_HOST',
    upgrade_required: 'UPGRADE_REQUIRED',
    // Request-shape rejections. validate-request.js emits `validation_failed`
    // on every Zod failure and several routes emit `INVALID_PARAM` by hand —
    // between them the most common 4xx in the app, and both were unmapped, so
    // a permanent request bug rendered as "try again".
    validation_failed: 'BAD_REQUEST',
    VALIDATION_ERROR: 'BAD_REQUEST',
    INVALID_PARAM: 'BAD_REQUEST',
    INVALID_INDEX: 'BAD_REQUEST',
    // The CSRF middleware already retried once with a fresh token before
    // surfacing this, so "retry" is not the advice — reloading is.
    csrf_invalid: 'SESSION_REFRESHED',
    // Paid-plan boundaries. These land at conversion moments, where the
    // generic card was costing an upgrade prompt.
    tier_limit_exceeded: 'UPGRADE_REQUIRED',
    MIGRATION_QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    AI_COST_CAP_REACHED: 'AI_COST_CAP_REACHED',
    INSUFFICIENT_PERMISSIONS: 'FORBIDDEN',
    admin_only: 'FORBIDDEN',
    FORBIDDEN: 'FORBIDDEN',
    // Terminal states: the thing already happened. Retrying re-fails forever.
    ALREADY_PUBLISHED: 'CONFLICT',
    NOT_EDITABLE: 'CONFLICT',
    DUPLICATE_IMPORT: 'CONFLICT',
    already_running: 'CONFLICT',
    NOT_FOUND: 'NOT_FOUND',
    // Codes the CLIENT throws (src/api/aiFetch.js) rather than the server.
    // These are already UPPERCASE but do not match a KNOWN_ERRORS key, so
    // without an alias they fall through to the bare HTTP-status heuristic —
    // which rendered "Session expired" for a rejected AI key and "rate
    // limited, try again shortly" for an exhausted monthly quota.
    AI_INVALID_KEY: 'AI_KEY_INVALID',
    AI_QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    AI_UNREACHABLE: 'AI_PROVIDER_UNAVAILABLE',
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

// formatUserError is invoked on every render of <AIErrorState>, so warning
// once per call would flood the console (we observed 15+ identical entries
// for one transient 500). Dedupe by a stable identity derived from the
// error envelope so the operator still sees one entry per *distinct* failure.
//   - WeakSet on the error object: catches the common case where the same
//     ApiError instance is re-rendered.
//   - Signature LRU: catches the case where a fresh ApiError is constructed
//     on each retry but represents the same underlying state.
const __warnedErrors = typeof WeakSet === 'function' ? new WeakSet() : null
const __warnedSignatures = new Set()
const __WARNED_SIGNATURES_MAX = 64

function warnUnmappedOnce(err) {
    if (!import.meta.env?.DEV) return
    if (typeof err === 'object' && err !== null) {
        if (__warnedErrors && __warnedErrors.has(err)) return
        if (__warnedErrors) __warnedErrors.add(err)
    }
    const sig = `${err?.name || ''}|${err?.status || ''}|${err?.data?.code || ''}|${(err?.message || '').slice(0, 80)}`
    if (__warnedSignatures.has(sig)) return
    __warnedSignatures.add(sig)
    if (__warnedSignatures.size > __WARNED_SIGNATURES_MAX) {
        // Cheap LRU eviction: drop the oldest entry. Iterator order is
        // insertion order on a Set.
        const first = __warnedSignatures.values().next().value
        __warnedSignatures.delete(first)
    }
     
    console.warn('[formatUserError] unmapped error:', err)
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
    if (status === 413 || /entity too large|payload too large/i.test(raw)) {
        return { ...KNOWN_ERRORS.PAYLOAD_TOO_LARGE, code: 'PAYLOAD_TOO_LARGE', raw: null }
    }

    // Understood status, unrecognised code. Better a correct family than the
    // generic card: the difference that matters to the user is whether Retry
    // is worth pressing, and for 4xx it never is.
    //
    // The caller's fallbackTitle still wins for the title — it names the
    // operation ("Failed to load branch protection"), which is knowledge the
    // status alone can't supply. The ladder contributes the part the caller
    // can't know: why it failed and whether retrying is worth offering.
    const ladderKey = STATUS_FALLBACKS[status] || (status >= 500 ? 'SERVER_ERROR' : null)
    if (ladderKey) {
        const entry = KNOWN_ERRORS[ladderKey]
        return {
            ...entry,
            title: ctx.fallbackTitle || entry.title,
            code: ladderKey,
            raw: null,
        }
    }

    warnUnmappedOnce(err)
    return {
        ...FALLBACK,
        title: ctx.fallbackTitle || FALLBACK.title,
        code: null,
        raw: null,
    }
}
