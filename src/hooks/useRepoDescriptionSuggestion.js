import { useCallback, useState } from 'react'
import { defaultRepoDescription, sanitizeRepoDescription } from '../utils/migrationDescription'

/**
 * Produces a description suggestion for a migration repo, either via Gemini
 * (when AI is available) or from a deterministic template. Always resolves —
 * a network failure silently falls through to the template so the caller can
 * blindly pipe the result into the textarea.
 *
 * Caller:
 *   const { suggest, isLoading } = useRepoDescriptionSuggestion({ aiAvailable })
 *   const { description, mode, quotaExceeded } = await suggest({ repo, source })
 *
 * `mode` is 'ai' only when Gemini produced the text; every fallback path
 * (AI off, 429, 5xx, parse error) reports 'template'. `quotaExceeded` is true
 * on 429 so callers can surface a toast once per session.
 */
export function useRepoDescriptionSuggestion({ aiAvailable } = {}) {
    const [isLoading, setIsLoading] = useState(false)

    const buildBody = (repo, source) => ({
        repoId: String(repo.id ?? ''),
        repoName: repo.targetName || repo.name || '',
        language: repo.language || null,
        size: Number.isFinite(repo.size) ? repo.size : 0,
        branches: Number.isFinite(repo.branches) ? repo.branches : 0,
        hasLfsMarker: !!repo.hasLfsMarker,
        lastCommitDate: repo.lastCommitDate || null,
        source: {
            org: source.org,
            project: source.project,
            isTfvc: !!repo.isTfvc,
            tfvcPath: repo.tfvcPath || null,
        },
    })

    const suggest = useCallback(async ({ repo, source }) => {
        const fallback = () => ({
            description: defaultRepoDescription({
                repoName: repo.targetName || repo.name,
                source: { ...source, isTfvc: !!repo.isTfvc, tfvcPath: repo.tfvcPath },
            }),
            mode: 'template',
            quotaExceeded: false,
        })

        if (!aiAvailable) return fallback()

        setIsLoading(true)
        try {
            const res = await fetch('/api/ai/migration-description', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildBody(repo, source)),
            })
            if (res.status === 429) return { ...fallback(), quotaExceeded: true }
            if (!res.ok) return fallback()
            const data = await res.json().catch(() => null)
            const text = data?.description
            if (typeof text !== 'string' || !text.trim()) return fallback()
            return {
                description: sanitizeRepoDescription(text),
                mode: 'ai',
                quotaExceeded: false,
            }
        } catch {
            return fallback()
        } finally {
            setIsLoading(false)
        }
    }, [aiAvailable])

    return { suggest, isLoading }
}
