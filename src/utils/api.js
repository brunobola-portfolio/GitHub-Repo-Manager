/*
 * GitHub Repo Manager
 * HTTP helpers, retry logic, and error normalization
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

// ============ Error Types ============

export const ErrorType = {
    NETWORK: 'NETWORK',
    TIMEOUT: 'TIMEOUT',
    AUTHENTICATION: 'AUTHENTICATION',
    AUTHORIZATION: 'AUTHORIZATION',
    NOT_FOUND: 'NOT_FOUND',
    RATE_LIMIT: 'RATE_LIMIT',
    SERVER: 'SERVER',
    VALIDATION: 'VALIDATION',
    OFFLINE: 'OFFLINE',
    UNKNOWN: 'UNKNOWN'
}

// User-friendly error messages
const ERROR_MESSAGES = {
    [ErrorType.NETWORK]: 'Unable to connect to the server. Please check your internet connection.',
    [ErrorType.TIMEOUT]: 'The request took too long to complete. Please try again.',
    [ErrorType.AUTHENTICATION]: 'Your session has expired. Please login again.',
    [ErrorType.AUTHORIZATION]: 'You do not have permission to perform this action.',
    [ErrorType.NOT_FOUND]: 'The requested resource was not found.',
    [ErrorType.RATE_LIMIT]: 'Too many requests. Please wait a moment before trying again.',
    [ErrorType.SERVER]: 'The server encountered an error. Please try again later.',
    [ErrorType.VALIDATION]: 'Invalid request. Please check your input.',
    [ErrorType.OFFLINE]: 'You appear to be offline. Please check your connection.',
    [ErrorType.UNKNOWN]: 'An unexpected error occurred. Please try again.'
}

// Custom API Error class
export class ApiError extends Error {
    constructor(type, message, status = null, originalError = null) {
        super(message || ERROR_MESSAGES[type] || ERROR_MESSAGES[ErrorType.UNKNOWN])
        this.name = 'ApiError'
        this.type = type
        this.status = status
        this.originalError = originalError
        this.isRetryable = [ErrorType.NETWORK, ErrorType.TIMEOUT, ErrorType.SERVER].includes(type)
        this.userMessage = ERROR_MESSAGES[type] || message
    }
}

// Categorize error based on status code
export function categorizeError(status, error = null) {
    if (!navigator.onLine) {
        return new ApiError(ErrorType.OFFLINE)
    }

    if (error?.name === 'AbortError') {
        return new ApiError(ErrorType.TIMEOUT)
    }

    if (error?.message?.includes('fetch') || error?.message?.includes('network')) {
        return new ApiError(ErrorType.NETWORK)
    }

    switch (status) {
        case 401:
            return new ApiError(ErrorType.AUTHENTICATION, null, status)
        case 403:
            return new ApiError(ErrorType.AUTHORIZATION, null, status)
        case 404:
            return new ApiError(ErrorType.NOT_FOUND, null, status)
        case 422:
        case 400:
            return new ApiError(ErrorType.VALIDATION, null, status)
        case 429:
            return new ApiError(ErrorType.RATE_LIMIT, null, status)
        case 500:
        case 502:
        case 503:
        case 504:
            return new ApiError(ErrorType.SERVER, null, status)
        default:
            if (status >= 500) {
                return new ApiError(ErrorType.SERVER, null, status)
            }
            return new ApiError(ErrorType.UNKNOWN, null, status)
    }
}

// ============ Retry Logic ============

const DEFAULT_RETRY_OPTIONS = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    timeout: 30000
}

// Calculate delay with exponential backoff and jitter
function calculateDelay(attempt, baseDelay, maxDelay) {
    const exponentialDelay = baseDelay * Math.pow(2, attempt)
    const jitter = Math.random() * 1000
    return Math.min(exponentialDelay + jitter, maxDelay)
}

// Sleep function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Fetch with retry logic
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
    const { maxRetries, baseDelay, maxDelay, timeout } = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions }

    let lastError = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // Check if offline before attempting
        if (!navigator.onLine) {
            throw new ApiError(ErrorType.OFFLINE)
        }

        try {
            // Create abort controller for timeout
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout)

            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            })

            clearTimeout(timeoutId)

            // If response is ok, return it
            if (response.ok) {
                return response
            }

            // Categorize the error
            const apiError = categorizeError(response.status)

            // Don't retry auth errors or not found
            if (!apiError.isRetryable) {
                throw apiError
            }

            lastError = apiError

        } catch (error) {
            // If it's already an ApiError, use it
            if (error instanceof ApiError) {
                if (!error.isRetryable || attempt === maxRetries) {
                    throw error
                }
                lastError = error
            } else {
                // Categorize native errors
                lastError = categorizeError(null, error)
                if (!lastError.isRetryable || attempt === maxRetries) {
                    throw lastError
                }
            }
        }

        // Wait before retrying (not on last attempt)
        if (attempt < maxRetries) {
            const delay = calculateDelay(attempt, baseDelay, maxDelay)
            console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`)
            await sleep(delay)
        }
    }

    throw lastError || new ApiError(ErrorType.UNKNOWN)
}

// ============ JSON Parsing ============

	export const safeParseJson = async (response) => {
    const ct = response && response.headers && response.headers.get ? response.headers.get('content-type') || '' : ''
    if (ct.includes('application/json') || ct.includes('application/vnd.github')) {
	        try {
	            return await response.json()
	        } catch {
            const txt = await response.text()
            throw new Error('Invalid JSON: ' + (txt ? txt.slice(0, 500) : 'empty'))
        }
    }
    const text = await response.text()
    return { __rawText: text, __contentType: ct }
}

export function parseLinkHeaderTotal(linkHeader) {
    try {
        const parts = linkHeader.split(',').map(p => p.trim())
        let last = null
        for (const p of parts) {
            const m = p.match(/<([^>]+)>;\s*rel="([^"]+)"/)
            if (m) {
                const url = m[1]
                const rel = m[2]
                if (rel === 'last') last = url
            }
        }
        if (!last) return null
        const u = new URL(last)
        const pnum = u.searchParams.get('page')
        return pnum ? parseInt(pnum, 10) : null
    } catch { return null }
}

// ============ API Helper ============

// High-level API call with retry, parsing, and error handling
export async function apiCall(url, options = {}, retryOptions = {}) {
    const response = await fetchWithRetry(url, {
        credentials: 'include',
        ...options
    }, retryOptions)

    return safeParseJson(response)
}
