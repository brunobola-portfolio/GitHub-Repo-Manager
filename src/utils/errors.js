/*
 * GitHub Repo Manager
 * Shared error utilities
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { ApiError, ErrorType } from './api'

/**
 * Get user-friendly error info based on error type
 */
export function getErrorInfo(error) {
    if (error instanceof ApiError) {
        return {
            type: error.type,
            message: error.userMessage,
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

    return {
        type: ErrorType.UNKNOWN,
        message: error?.message || 'An unexpected error occurred.',
        isRetryable: true,
        status: null
    }
}
