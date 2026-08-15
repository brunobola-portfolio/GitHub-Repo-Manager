// SPDX-License-Identifier: Apache-2.0
/**
 * Per-call output-token cap for AI generations. Bounds the cost and latency of
 * a single request so a runaway generation can't drain budget or hang the UI
 * (OWASP LLM10 — unbounded consumption / denial-of-wallet).
 *
 * Provider-neutral: the generate layer (`ai-provider.js`) maps `maxOutputTokens`
 * onto each SDK's field (Gemini `maxOutputTokens`, OpenAI `max_tokens`, …), so
 * callers just pass `generationConfig: { maxOutputTokens: resolveMaxOutputTokens() }`.
 */

export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
export const MIN_MAX_OUTPUT_TOKENS = 256;
export const MAX_MAX_OUTPUT_TOKENS = 8192;

/**
 * Resolve the per-call output-token cap from `AI_MAX_OUTPUT_TOKENS`, clamped to
 * a sane range so a misconfiguration can neither disable the cap nor set it
 * absurdly high. Invalid / non-positive / non-numeric values fall back to the
 * default.
 * @returns {number}
 */
export function resolveMaxOutputTokens() {
    const raw = Number.parseInt(process.env.AI_MAX_OUTPUT_TOKENS ?? '', 10);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_OUTPUT_TOKENS;
    return Math.min(Math.max(raw, MIN_MAX_OUTPUT_TOKENS), MAX_MAX_OUTPUT_TOKENS);
}
