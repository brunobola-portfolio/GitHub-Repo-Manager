/**
 * Sanitize user-controlled text before interpolation into AI prompts.
 * Truncates to maxLen, strips null bytes, and returns empty string for falsy input.
 *
 * Re-exported from server/ai-service.js for backwards compat — new code
 * should import from here directly to avoid pulling in the service.
 *
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
export function sanitizeForPrompt(text, maxLen = 5000) {
    if (!text) return '';
    const cleaned = String(text).replace(/\0/g, '');
    return cleaned.slice(0, maxLen);
}
