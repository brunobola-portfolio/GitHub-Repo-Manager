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
            let mapped = list
                .filter((m) => m?.id)
                .map((m) => {
                    const inputModalities = m?.architecture?.input_modalities || []
                    const supportedParams = m?.supported_parameters || []
                    const capabilities = []
                    if (inputModalities.includes('image')) capabilities.push('vision')
                    if (supportedParams.includes('tools') || supportedParams.includes('tool_choice')) capabilities.push('tools')
                    if (supportedParams.includes('response_format') || supportedParams.includes('structured_outputs')) capabilities.push('json')
                    if (supportedParams.includes('reasoning') || /reasoning|thinking|o1|o3|o4/i.test(m.id || '')) capabilities.push('reasoning')

                    // OpenRouter prices are USD per token as strings; convert to per-million dollars.
                    const promptPrice = m?.pricing?.prompt ? Number(m.pricing.prompt) * 1_000_000 : undefined
                    const completionPrice = m?.pricing?.completion ? Number(m.pricing.completion) * 1_000_000 : undefined
                    const pricing = (promptPrice !== undefined && completionPrice !== undefined)
                        ? { input: promptPrice, output: completionPrice, currency: 'USD', per: '1M tokens' }
                        : undefined

                    return {
                        id: m.id,
                        label: m.name || m.id,
                        tier: tierFor(m.id),
                        description: (m.description || '').replace(/\s+/g, ' ').slice(0, 90),
                        context: formatContext(m.context_length),
                        capabilities,
                        pricing,
                        recommended: false,
                        legacy: false,
                    }
                })
                // Sort: balanced/smart/reasoning first, then alphabetical by label
                .sort((a, b) => a.label.localeCompare(b.label))
            // Mark a single recommended pick — Claude Sonnet 4.6 via OR is the
            // strongest balanced default at the time of writing. Falls back to
            // the first balanced/smart entry if Sonnet 4.6 isn't returned.
            const preferredId = 'anthropic/claude-sonnet-4-6'
            let recIdx = mapped.findIndex((m) => m.id === preferredId)
            if (recIdx < 0) recIdx = mapped.findIndex((m) => m.tier === 'balanced' || m.tier === 'smart')
            if (recIdx >= 0) mapped[recIdx] = { ...mapped[recIdx], recommended: true }
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
