/*
 * GitHub Repo Manager
 * AI features hook (chat, suggestions, readme generation)
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the GNU AGPL v3.0 only (SPDX: AGPL-3.0-only). See LICENSE in the project root.
 */

import { useCallback } from 'react'
import { safeParseJson, isSessionExpired, getCsrfToken } from '../utils/api'
import { isAbort } from '../utils/errorClassification'
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
            } else if (/create|new repo/.test(msg)) {
                actions.push({ type: 'open_create_repo', label: 'Create Repository' })
            }
            return {
                reply: actions.length
                    ? 'Sure, I can open that for you.'
                    : 'Based on the analysis of your repository structure, I recommend adding a CONTRIBUTING.md file. Would you like to explore migrations or create a new repo?',
                actions,
            }
        }
        if (isSessionExpired()) {
            const err = new Error('Your session has expired. Please login again.')
            err.code = 'SESSION_EXPIRED'
            throw err
        }
        let csrfHeader
        try {
            csrfHeader = await getCsrfToken()
        } catch (csrfErr) {
            const err = new Error('Could not establish a secure session. Please reload and try again.')
            err.code = 'CSRF_FETCH_FAILED'
            err.cause = csrfErr
            throw err
        }
        // 60s client-side timeout — keeps the chat surface from hanging
        // forever when the provider stalls. We synthesize an err.code of
        // AI_TIMEOUT so AIErrorState renders the correct CTA without
        // depending on the server reporting it.
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 60_000)
        let r
        try {
            r = await fetch(`${API_BASE}/ai/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfHeader },
                body: JSON.stringify({ message, context }),
                credentials: 'include',
                signal: controller.signal,
            })
        } catch (networkErr) {
            if (isAbort(networkErr)) {
                const err = new Error('AI request timed out after 60s. Please try again.')
                err.code = 'AI_TIMEOUT'
                throw err
            }
            const err = new Error('Could not reach the AI service. Check your connection.')
            err.code = 'NETWORK_ERROR'
            err.cause = networkErr
            throw err
        } finally {
            clearTimeout(timeoutId)
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
