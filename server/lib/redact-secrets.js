/**
 * Remove likely-secret substrings from an arbitrary string before logging or
 * returning to the client. Covers prefixes for all supported providers plus
 * URLs with embedded basic-auth credentials.
 *
 * Safe to call on untrusted input — returns a string even if input is null/undefined.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function redactSecrets(value) {
    if (value == null) return ''
    const s = String(value)
    return s
        // OpenAI / Anthropic / OpenRouter / generic sk-*
        .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]')
        // Some vendors use key_* prefix
        .replace(/key_[A-Za-z0-9_-]{8,}/g, 'key_[REDACTED]')
        // Google/Gemini (AIza...)
        .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'AIza[REDACTED]')
        // URLs with embedded basic-auth (user:pass@host)
        .replace(/(https?:\/\/)[^@\s/]+@([^\s]+)/g, '$1[REDACTED]@$2')
}
