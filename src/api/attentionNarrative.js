import { aiFetchJson } from './aiFetch'

/**
 * Fetch the AI-generated one-line narrative for the dashboard top item.
 *
 * Returns { narrative, cached, model } on success, or null on any failure.
 * Failures are silent by design — the narrative is a garnish on top of the
 * Attention Feed, never the primary content. The caller decides whether to
 * render anything based on a non-null return.
 *
 * @param {{ repo: string, kind: string, signalPayload?: object, abortSignal?: AbortSignal }} args
 */
export async function fetchAttentionNarrative({ repo, kind, signalPayload, abortSignal }) {
    try {
        return await aiFetchJson('/api/ai/attention-narrative', {
            method: 'POST',
            body: JSON.stringify({ repo, kind, signal: signalPayload ?? {} }),
            signal: abortSignal,
        })
    } catch {
        return null
    }
}
