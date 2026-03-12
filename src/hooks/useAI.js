/*
 * GitHub Repo Manager
 * AI features hook (chat, suggestions, readme generation)
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useCallback } from 'react'
import { safeParseJson, isSessionExpired } from '../utils/api'
import { MOCK_MODE, API_ENDPOINTS } from '../config'

/**
 * Hook for AI-powered features: chat, suggestions, and README generation.
 *
 * All methods are stateless (no internal state) -- they return promises
 * so callers can manage loading/error state as needed.
 *
 * @returns {{ checkAIStatus, askAI, suggestAI, generateReadmeAI }}
 */
export function useAI() {
    /**
     * Check if AI is configured on the server
     */
    const checkAIStatus = useCallback(async () => {
        if (MOCK_MODE) return { configured: true }
        try {
            const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/config/ai-status`)
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
        const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/ai/chat`, {
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

    /**
     * Get AI suggestions for a repository
     * @param {object} repo - Repository object
     * @returns {Promise<{ suggestions: Array, analysis: string }>}
     */
    const suggestAI = useCallback(async (repo) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 1500))
            return {
                suggestions: [
                    { title: "Add Security Policy", description: "Create a SECURITY.md to define how to report vulnerabilities.", type: "security", priority: "high" },
                    { title: "Improve CI/CD Pipeline", description: "Add GitHub Actions for automated testing on pull requests.", type: "devops", priority: "medium" },
                    { title: "Update Dependencies", description: "Several dependencies are outdated. Consider running npm update.", type: "maintenance", priority: "low" }
                ],
                analysis: "The repository shows a solid structure but lacks comprehensive documentation for the API endpoints. Code quality is generally high, with consistent formatting."
            }
        }
        if (isSessionExpired()) throw new Error('Your session has expired. Please login again.')
        const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/ai/suggest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo }),
            credentials: 'include'
        })
        if (r.status === 401) throw new Error('Your session has expired. Please login again.')
        if (!r.ok) {
            const errData = await safeParseJson(r).catch(() => ({}))
            throw new Error(errData?.error || errData?.message || `AI request failed (${r.status})`)
        }
        return await safeParseJson(r)
    }, [])

    /**
     * Generate a README file using AI
     * @param {object} details - Repository details for context
     * @returns {Promise<{ readme: string }>}
     */
    const generateReadmeAI = useCallback(async (details) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 2000))
            return { readme: "# Project Title\n\n## Overview\nThis is a high-performance application built with React and Node.js.\n\n## Features\n- Real-time data processing\n- AI-powered insights\n- Glassmorphism UI\n\n## Installation\n```bash\nnpm install\nnpm run dev\n```" }
        }
        if (isSessionExpired()) throw new Error('Your session has expired. Please login again.')
        const r = await fetch(`${API_ENDPOINTS.repos.replace('/repos', '')}/ai/readme`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(details),
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
        askAI,
        suggestAI,
        generateReadmeAI
    }
}
