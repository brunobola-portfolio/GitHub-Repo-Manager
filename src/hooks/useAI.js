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
     * @returns {Promise<{ reply: string, actions: Array<{type: string, label: string}> }>}
     * @throws {Error} with .code, .status, .friendlyMessage populated for UI branching
     */
    const askAI = useCallback(async (message, context) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 800))
            const msg = String(message || '').toLowerCase()
            const actions = []
            if (/migra|import|mov[ei]/.test(msg)) {
                actions.push({ type: 'open_migration_wizard', label: 'Open Migration Wizard' })
            } else if (/criar|create|novo repo|new repo/.test(msg)) {
                actions.push({ type: 'open_create_repo', label: 'Create Repository' })
            }
            return {
                reply: actions.length
                    ? 'Claro, posso abrir isso para ti.'
                    : 'Based on the analysis of your repository structure, I recommend adding a CONTRIBUTING.md file. Would you like to explore migrations or create a new repo?',
                actions,
            }
        }
        if (isSessionExpired()) {
            const err = new Error('Your session has expired. Please login again.')
            err.code = 'SESSION_EXPIRED'
            throw err
        }
        let r
        try {
            r = await fetch(`${API_BASE}/ai/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, context }),
                credentials: 'include',
            })
        } catch (networkErr) {
            const err = new Error('Could not reach the AI service. Check your connection.')
            err.code = 'NETWORK_ERROR'
            err.cause = networkErr
            throw err
        }
        if (!r.ok) {
            const body = await safeParseJson(r).catch(() => ({}))
            const code = body?.error || body?.code || `HTTP_${r.status}`
            const err = new Error(body?.message || body?.error || `AI request failed (${r.status})`)
            err.status = r.status
            err.code = code
            err.friendlyMessage = body?.message
            throw err
        }
        let body
        try {
            body = await safeParseJson(r)
        } catch (parseErr) {
            const err = new Error('AI returned an invalid response. Please retry.')
            err.code = 'AI_PARSE_ERROR'
            err.cause = parseErr
            throw err
        }
        const reply = body?.reply || body?.message
        if (typeof reply !== 'string' || !reply) {
            const err = new Error('AI returned an empty response. Please retry.')
            err.code = 'AI_EMPTY_REPLY'
            throw err
        }
        return {
            reply,
            actions: Array.isArray(body?.actions) ? body.actions : [],
        }
    }, [])

    return {
        checkAIStatus,
        askAI
    }
}
