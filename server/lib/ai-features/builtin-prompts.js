/**
 * Built-in AI Deep Review prompt presets — read-only lenses surfaced to all users.
 *
 * Each `body` is APPENDED to the base `pr_deep_review` system prompt by the
 * resolver (server/lib/ai-features/prompt-registry.js). It does NOT replace it —
 * the JSON output schema, line-comment cap, and fence rules from the base must
 * still hold.
 */

const GENERAL = `Provide a balanced review covering bug risk, code quality, readability, and test coverage. Weight findings by likely impact: highlight a small number of high-confidence issues over many speculative ones.`;

const SECURITY = `Focus on security: OWASP top 10 (injection, XSS, CSRF, broken auth, sensitive data exposure, insecure deserialization), secrets in code, missing input validation, weak crypto, SSRF, path traversal, prototype pollution. Flag every credential / API key / private value that appears in the diff. Bias severity toward 'warning' or 'critical' when in doubt.`;

const PERFORMANCE = `Focus on performance: N+1 queries, missing indexes, unnecessary re-renders, large bundle additions, synchronous I/O on the hot path, missing memoization, allocations inside loops, unbounded resource use. Mention complexity (O(n²) etc) when meaningful. Suggest concrete fixes (e.g. "use Map instead of repeated array.find").`;

const ACCESSIBILITY = `Focus on accessibility (WCAG 2.1 AA): ARIA roles + labels, semantic HTML, keyboard navigation, focus management, color contrast, alt text, form labels, focus traps in modals, skip-links. Call out any interactive element that lacks an accessible name. Flag color-only signals.`;

const REFACTOR = `Focus on refactoring opportunities: dead code, duplication, abstraction opportunities, naming clarity, function length, separation of concerns. Bias severity toward 'info' or 'suggestion' — these are non-blocking improvements, not defects. Skip if the diff is purely additive and not in already-tangled code.`;

export const BUILTIN_PRESETS = Object.freeze({
    general: { key: 'general', name: 'General', body: GENERAL, severityFloor: null },
    security: { key: 'security', name: 'Security audit', body: SECURITY, severityFloor: 'warning' },
    performance: { key: 'performance', name: 'Performance', body: PERFORMANCE, severityFloor: null },
    accessibility: { key: 'accessibility', name: 'Accessibility', body: ACCESSIBILITY, severityFloor: null },
    refactor: { key: 'refactor', name: 'Refactor coach', body: REFACTOR, severityFloor: 'info' },
});

export const BUILTIN_KEYS = Object.freeze(Object.keys(BUILTIN_PRESETS));

export function isBuiltinKey(key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(BUILTIN_PRESETS, key);
}

export function getBuiltin(key) {
    return BUILTIN_PRESETS[key] ?? null;
}
