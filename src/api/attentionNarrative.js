import { aiFetchJson, AIQuotaExceededError } from './aiFetch'
import { MOCK_MODE } from '../config'

/**
 * Fetch the AI-generated one-line narrative for the dashboard top item.
 *
 * Returns { narrative, cached, model } on success, or null on most failures.
 * The narrative is a garnish on top of the Attention Feed, so generic
 * failures stay silent — but quota-exceeded RE-THROWS so the caller can
 * stop fanning out and render a single, polished notice instead of N empty
 * rows. Anything else still resolves to null.
 *
 * @param {{ repo: string, kind: string, signalPayload?: object, abortSignal?: AbortSignal }} args
 */
export async function fetchAttentionNarrative({ repo, kind, signalPayload, abortSignal }) {
    if (MOCK_MODE) return null
    try {
        return await aiFetchJson('/api/ai/attention-narrative', {
            method: 'POST',
            body: JSON.stringify({ repo, kind, signal: signalPayload ?? {} }),
            signal: abortSignal,
        })
    } catch (err) {
        if (err instanceof AIQuotaExceededError) throw err
        return null
    }
}
