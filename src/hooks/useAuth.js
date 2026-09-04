/*
 * GitHub Repo Manager
 * Authentication & session management hook
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the Apache License 2.0 (SPDX: Apache-2.0). See LICENSE in the project root.
 */

import { useState, useEffect, useCallback } from 'react'
import {
    safeParseJson,
    fetchWithRetry,
    ErrorType
} from '../utils/api'
import { getErrorInfo } from '../utils/errors'
import { MOCK_MODE, API_ENDPOINTS } from '../config'

/**
 * Hook for authentication and session management.
 *
 * Manages the current user state and provides fetchUser to retrieve
 * the authenticated GitHub user from the backend API.
 *
 * @returns {{ user, fetchUser, authLoading, authError, authErrorInfo, authMessage }}
 */
export function useAuth() {
    const [user, setUser] = useState(null)
    const [authLoading, setAuthLoading] = useState(false)
    const [authError, setAuthError] = useState(null)
    const [authErrorInfo, setAuthErrorInfo] = useState(null)
    const [authMessage, setAuthMessage] = useState('')

    // Initialize mock user if in mock mode
    useEffect(() => {
        if (MOCK_MODE) {
            const mockUser = {
                login: 'dev-user',
                avatar_url: 'https://github.com/ghost.png',
                name: 'Alex Developer',
                bio: 'Senior Software Engineer | Open Source Enthusiast | AI & React',
                company: 'TechCorp Inc.',
                location: 'San Francisco, CA',
                followers: 1243,
                following: 89
            }
            // eslint-disable-next-line react-hooks/set-state-in-effect -- mock-mode bootstrap, runs once on mount
            setUser(mockUser)
        }
    }, [])

    /**
     * Fetch current user from API with retry logic
     */
    const fetchUser = useCallback(async () => {
        setAuthLoading(true)
        setAuthError(null)
        setAuthErrorInfo(null)

        try {
            const r = await fetchWithRetry(API_ENDPOINTS.user, { credentials: 'include' })
            const parsed = await safeParseJson(r)

            if (parsed && parsed.__rawText) {
                setUser(null)
                setAuthError('Invalid response')
                setAuthErrorInfo({
                    type: ErrorType.SERVER,
                    message: 'Unexpected response from server. Try again.',
                    isRetryable: true
                })
                setAuthMessage('Unexpected response from server.')
                return
            }

            setUser(parsed)
            setAuthMessage('')
        } catch (e) {
            const info = getErrorInfo(e)
            setUser(null)
            setAuthError(info.message)
            setAuthErrorInfo(info)
            setAuthMessage(info.message)
        } finally {
            setAuthLoading(false)
        }
    }, [])

    return {
        user,
        fetchUser,
        authLoading,
        authError,
        authErrorInfo,
        authMessage
    }
}
