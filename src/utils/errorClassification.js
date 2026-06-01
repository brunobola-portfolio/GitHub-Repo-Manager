/*
 * GitHub Repo Manager
 * Client-error classification — separates app errors from third-party noise.
 *
 * Browser extensions (uBlock, password managers, dev tools, antivirus) inject
 * content scripts that throw their own errors into the page's window. Without
 * a filter those land in our `unhandledrejection` / `error` handlers, get
 * reported to Sentry/the backend, and clutter the UI as if the app failed.
 * Same story for famous benign browser noise like the ResizeObserver-loop
 * warning and cross-origin "Script error." messages.
 */

// Patterns are intentionally NOT anchored — they're matched against both
// `event.filename` (the URL itself) AND the error stack (where the URL
// appears mid-string), so a leading `^` would miss every stack hit.
const EXTENSION_SOURCE_PATTERNS = [
    /chrome-extension:\/\//i,
    /moz-extension:\/\//i,
    /safari-(?:web-)?extension:\/\//i,
    /\bproxy\.js\b/i,
    /\binject(?:ed)?(?:\.js)?\b/i,
    /\bcontent[-_]script(?:s)?\b/i,
]

const EXTENSION_MESSAGE_PATTERNS = [
    /disconnected port object/i,
    /extension context invalidated/i,
    /the message port closed before a response/i,
    /could not establish connection\. receiving end does not exist/i,
]

const BENIGN_NOISE_PATTERNS = [
    /^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/i,
    // Cross-origin scripts the browser refuses to expose — never actionable.
    /^Script error\.?$/i,
]

function matchesAny(value, patterns) {
    if (!value || typeof value !== 'string') return false
    return patterns.some(p => p.test(value))
}

function extractStack(error) {
    if (!error) return ''
    if (typeof error === 'string') return error
    return error.stack || error.message || '' // eslint-disable-line no-restricted-syntax -- internal error classification; .stack is never exposed to UI
}

/**
 * Returns true if the given error / ErrorEvent is browser-extension noise that
 * shouldn't be reported as an app error.
 */
export function isExtensionError(error, source) {
    if (matchesAny(source, EXTENSION_SOURCE_PATTERNS)) return true
    const stack = extractStack(error)
    if (matchesAny(stack, EXTENSION_SOURCE_PATTERNS)) return true
    const message = error instanceof Error ? error.message : (typeof error === 'string' ? error : '')
    if (matchesAny(message, EXTENSION_MESSAGE_PATTERNS)) return true
    return false
}

/**
 * Single source of truth for "was this an aborted/cancelled request?".
 *
 * Returns true when either the AbortController's signal is already aborted OR
 * the caught error is an AbortError (by name, or by a stack/message mention for
 * the cases where the name is lost across a wrapper). Pass the signal too when
 * you have it — a fetch can reject for an unrelated reason on the same tick the
 * signal aborts, and the bare error name alone would miss that.
 *
 * Replaces ~25 hand-rolled `e?.name === 'AbortError'` variants that each risked
 * forgetting the `signal.aborted` half.
 *
 * @param {unknown} error  the caught error (may be null when only checking a signal)
 * @param {{ aborted?: boolean }} [signal]  an AbortSignal, if available
 */
export function isAbort(error, signal) {
    if (signal?.aborted) return true
    if (error?.name === 'AbortError') return true
    const message = error instanceof Error ? error.message : (typeof error === 'string' ? error : '')
    return /\bAbortError\b/.test(message)
}

/**
 * Returns true for errors that are noisy but not actionable — extension noise,
 * ResizeObserver loops, opaque cross-origin script errors, aborted fetches.
 * Use to silently drop telemetry without reporting or surfacing in the UI.
 */
export function shouldIgnoreClientError(error, source) {
    if (!error && !source) return true
    if (isExtensionError(error, source)) return true
    const message = error instanceof Error ? error.message : (typeof error === 'string' ? error : '')
    if (matchesAny(message, BENIGN_NOISE_PATTERNS)) return true
    // StrictMode and route changes routinely abort in-flight fetches.
    if (isAbort(error)) return true
    return false
}
