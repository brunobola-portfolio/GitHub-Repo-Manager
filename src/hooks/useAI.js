/*
 * GitHub Repo Manager
 * AI features hook (chat, suggestions, readme generation)
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useCallback } from 'react'
import { safeParseJson, isSessionExpired } from '../utils/api'
import { MOCK_MODE, API_BASE } from '../config'

/**
 * Hook for AI-powered features: chat, suggestions, and README generation.
 *
 * All methods are stateless (no internal state) -- they return promises
 * so callers can manage loading/error state as needed.
 *
 * @returns {{ checkAIStatus, askAI }}
 */
export function useAI() {
    /**
     * Check if AI is configured on the server
     */
    const checkAIStatus = useCallback(async () => {
        if (MOCK_MODE) return { configured: true }
        try {
            const r = await fetch(`${API_BASE}/config/ai-status`, { credentials: 'include' })
            return await safeParseJson(r)
        } catch (e) {
            return { configured: false }
        }
    }, [])

    /**
     * Send a chat message to the AI assistant
     * @param {string} message - User message
     * @param {object} context - Contextual data (repos, user info, etc.)
     * @returns {Promise<{ message: string }>}
     */
    const askAI = useCallback(async (message, context) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 1000))
            return { message: "Based on the analysis of your repository structure, I recommend adding a CONTRIBUTING.md file to guide new contributors. Additionally, your test coverage seems low in the `utils` directory. Would you like me to generate some test templates for you?" }
        }
        if (isSessionExpired()) throw new Error('Your session has expired. Please login again.')
        const r = await fetch(`${API_BASE}/ai/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, context }),
            credentials: 'include'
        })
        if (r.status === 401) throw new Error('Your session has expired. Please login again.')
        if (!r.ok) {
            const errData = await safeParseJson(r).catch(() => ({}))
            throw new Error(errData?.error || errData?.message || `AI request failed (${r.status})`)
        }
        return await safeParseJson(r)
    }, [])

    return {
        checkAIStatus,
        askAI
    }
}
