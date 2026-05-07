import { useEffect, useState } from 'react'
import { getCompletionModels, getEmbeddingModels } from '../utils/providerModels'

// OpenRouter exposes its full catalogue at /api/v1/models with no auth and
// CORS open, so we fetch it from the browser. Module-level cache so opening
// Settings repeatedly doesn't refire the request.
let openrouterCache = null
let openrouterPromise = null

function tierFor(id = '') {
    const lower = id.toLowerCase()
    if (/free|:free/.test(lower)) return 'open'
    if (/o1|o3|opus|gpt-5|sonnet-thinking|reasoner/.test(lower)) return 'reasoning'
    if (/llama|mistral|qwen|deepseek|gemma|nous|wizardlm/.test(lower)) return 'open'
    if (/sonnet|gpt-4|gemini-2\.5-pro|command-r-plus/.test(lower)) return 'smart'
    if (/haiku|mini|flash|nano|small/.test(lower)) return 'fast'
    return 'balanced'
}

function formatContext(n) {
    if (!n) return undefined
    if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`
    if (n >= 1000) return `${Math.round(n / 1000)}K`
    return String(n)
}

async function fetchOpenRouterModels() {
    if (openrouterCache) return openrouterCache
    if (openrouterPromise) return openrouterPromise
    openrouterPromise = (async () => {
        try {
            const res = await fetch('https://openrouter.ai/api/v1/models', { credentials: 'omit' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const body = await res.json()
            const list = Array.isArray(body?.data) ? body.data : []
            const mapped = list
                .filter((m) => m?.id)
                .map((m) => ({
                    id: m.id,
                    label: m.name || m.id,
                    tier: tierFor(m.id),
                    description: (m.description || '').replace(/\s+/g, ' ').slice(0, 90),
                    context: formatContext(m.context_length),
                }))
                // Sort: balanced/smart/reasoning first, then alphabetical by label
                .sort((a, b) => a.label.localeCompare(b.label))
            openrouterCache = mapped
            return mapped
        } catch {
            openrouterPromise = null
            return null
        }
    })()
    return openrouterPromise
}

/**
 * Returns the curated list for non-OpenRouter providers, and the live full
 * OpenRouter catalogue for `provider === 'openrouter'`. Falls back to the
 * static curated list on fetch failure (e.g. offline) so the picker is never
 * empty.
 */
export function useCompletionModels(provider) {
    const fallback = getCompletionModels(provider)
    const [models, setModels] = useState(() =>
        provider === 'openrouter' && openrouterCache ? openrouterCache : fallback,
    )

    /* eslint-disable react-hooks/set-state-in-effect -- mirroring an external
       module-level cache into local state is the simplest path; the cache
       itself is the deduper, so this never re-fires. */
    useEffect(() => {
        if (provider !== 'openrouter') {
            setModels(fallback)
            return undefined
        }
        if (openrouterCache) {
            setModels(openrouterCache)
            return undefined
        }
        let active = true
        fetchOpenRouterModels().then((m) => {
            if (active && m && m.length > 0) setModels(m)
        })
        return () => {
            active = false
        }
        // fallback is recomputed each render but its content is stable per
        // provider — depending on provider keeps the effect minimal.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider])
    /* eslint-enable react-hooks/set-state-in-effect */

    return models
}

export function useEmbeddingModels(provider) {
    // Embedding catalogues are short and well-known, no need to fetch live.
    return getEmbeddingModels(provider)
}
