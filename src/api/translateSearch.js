import { aiFetchJson } from './aiFetch'

/**
 * Translate a natural-language query into GitHub search syntax via the
 * AI provider. Returns { summary, queries, fallback, cached } on success
 * or null on any failure — the palette degrades silently to literal
 * text search.
 *
 * @param {{ q: string, signal?: AbortSignal }} args
 */
export async function translateSearch({ q, signal }) {
    try {
        return await aiFetchJson('/api/ai/translate-search', {
            method: 'POST',
            body: JSON.stringify({ q }),
            signal,
        })
    } catch {
        return null
    }
}
