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
