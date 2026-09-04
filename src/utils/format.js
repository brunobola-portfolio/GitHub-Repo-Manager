/**
 * Utility functions for formatting numbers, dates, and other data types
 * for display in the GitHub Repo Manager UI
 */

/**
 * Default locale for the whole formatting module. The UI ships in English, so
 * BOTH numbers and dates are pinned to en-US rather than the browser locale:
 *   - numbers render en-US style (1,234 / 1.23M);
 *   - dates render month-first (7/5/2026) so a pt-PT browser doesn't show a
 *     day-first date (5/7/2026) inside an otherwise-English sentence.
 * Override per-call via `options.locale` on formatNumber/formatCompact if a
 * localised surface ever lands.
 */
export const APP_LOCALE = 'en-US'

/**
 * Formats a number with thousand separators
 * @param {number} value - The number to format
 * @param {object} options - Formatting options
 * @param {string} options.locale - Locale for formatting (default: APP_LOCALE)
 * @param {number} options.minimumFractionDigits - Minimum decimal places
 * @param {number} options.maximumFractionDigits - Maximum decimal places
 * @param {string} options.notation - 'standard' or 'compact'
 * @param {string} options.compactDisplay - 'short' or 'long' (for compact notation)
 * @returns {string} Formatted number string
 * @example
 * formatNumber(1234)    // "1,234"  (default en-US)
 * formatNumber(1234567) // "1,234,567"
 * formatNumber(1234, { locale: 'pt-PT' }) // "1.234"
 */
export function formatNumber(value, options = {}) {
	const {
		locale = APP_LOCALE,
		minimumFractionDigits = 0,
		maximumFractionDigits = 0,
		notation = 'standard',
		compactDisplay = 'short'
	} = options

	// Handle null, undefined, or non-numeric values
	if (value == null || isNaN(value)) return '0'

	try {
		return new Intl.NumberFormat(locale, {
			minimumFractionDigits,
			maximumFractionDigits,
			notation,
			compactDisplay
		}).format(value)
	} catch (error) {
		// Fallback to simple string conversion if Intl.NumberFormat fails
		return String(value)
	}
}

/**
 * Formats a number in compact form (1K, 1M, 1B)
 * @param {number} value - The number to format
 * @param {string} locale - Locale for formatting (default: APP_LOCALE = 'en-US')
 * @returns {string} Compact formatted number
 * @example
 * formatCompact(1234)    // "1.2K"
 * formatCompact(1234567) // "1.2M"
 */
export function formatCompact(value, locale = APP_LOCALE) {
	if (value == null || isNaN(value)) return '0'

	try {
		return new Intl.NumberFormat(locale, {
			notation: 'compact',
			compactDisplay: 'short',
			maximumFractionDigits: 1
		}).format(value)
	} catch (error) {
		// Fallback to manual compact formatting
		if (value >= 1000000000) {
			return `${(value / 1000000000).toFixed(1)}B`
		}
		if (value >= 1000000) {
			return `${(value / 1000000).toFixed(1)}M`
		}
		if (value >= 1000) {
			return `${(value / 1000).toFixed(1)}K`
		}
		return String(value)
	}
}

/**
 * Formats a percentage value
 * @param {number} value - The percentage value (0-100)
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted percentage string
 * @example
 * formatPercentage(45.678) // "45.7%"
 * formatPercentage(45.678, 2) // "45.68%"
 */
export function formatPercentage(value, decimals = 1) {
	const num = Number(value)
	if (value == null || isNaN(num)) return '0%'

	return `${num.toFixed(decimals)}%`
}

/**
 * Formats a file size in bytes to a human-readable format
 * @param {number} bytes - The size in bytes
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted file size
 * @example
 * formatFileSize(1024) // "1.00 KB"
 * formatFileSize(1048576) // "1.00 MB"
 */
export function formatFileSize(bytes, decimals = 2) {
	if (bytes == null || isNaN(bytes) || bytes < 0) return '0 Bytes'
	if (bytes === 0) return '0 Bytes'

	const k = 1024
	const dm = decimals < 0 ? 0 : decimals
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']

	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

/**
 * Naive SQLite timestamp shape: 'YYYY-MM-DD HH:MM:SS' (optionally 'T'-separated,
 * optional fractional seconds) with NO timezone designator. This is exactly what
 * `CURRENT_TIMESTAMP` / `datetime('now')` emit — a UTC wall-clock value with the
 * 'Z' stripped. `new Date()` reads such a string as LOCAL time, so every
 * server-sourced timestamp would be off by the viewer's UTC offset.
 */
const NAIVE_SQLITE_TS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/

/**
 * Parse a timestamp coming from the server or an API into a Date, treating the
 * naive SQLite shape as UTC (append 'Z') so it doesn't get misread as local time.
 *
 * Contract — what each input shape resolves to:
 *   - naive 'YYYY-MM-DD HH:MM:SS' (± 'T' separator, ± fractional secs, NO zone)
 *       → interpreted as UTC (the server's actual meaning).
 *   - ISO strings that already carry a zone ('...Z', '...+01:00', '...-0500')
 *       → passed through untouched (native parse; already unambiguous).
 *   - date-only 'YYYY-MM-DD' → passed through (native parse already treats it as UTC).
 *   - epoch numbers (ms) and Date instances → returned as-is (absolute already).
 *   - null / undefined / '' / unparseable → null (callers guard on it).
 *
 * @param {Date|string|number|null|undefined} value
 * @returns {Date|null}
 */
export function parseServerTimestamp(value) {
	if (value == null) return null
	if (value instanceof Date) return isNaN(value.getTime()) ? null : value
	if (typeof value === 'number') {
		const d = new Date(value)
		return isNaN(d.getTime()) ? null : d
	}
	if (typeof value !== 'string') return null
	const str = value.trim()
	if (!str) return null
	// Naive UTC wall-clock with no zone marker → normalize to explicit UTC.
	const normalized = NAIVE_SQLITE_TS_RE.test(str) ? str.replace(' ', 'T') + 'Z' : str
	const d = new Date(normalized)
	return isNaN(d.getTime()) ? null : d
}

/**
 * Format a date using the user's locale (date only, no time).
 * Returns empty string for nullish / unparseable input so it's safe to drop
 * straight into JSX without ternary guards.
 *
 * @param {Date|string|number|null|undefined} value
 * @param {object} [options] - Intl.DateTimeFormat options
 * @returns {string}
 */
export function formatDate(value, options = {}) {
	const d = parseServerTimestamp(value)
	if (!d) return ''
	try {
		// Pinned to APP_LOCALE (see APP_LOCALE doc) — dates stay month-first
		// regardless of the viewer's browser locale.
		return d.toLocaleDateString(APP_LOCALE, options)
	} catch {
		return d.toISOString().split('T')[0]
	}
}

/**
 * Format a date+time using the user's locale (medium time precision).
 *
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function formatDateTime(value) {
	const d = parseServerTimestamp(value)
	if (!d) return ''
	try {
		// Pinned to APP_LOCALE (see APP_LOCALE doc) for the same reason as formatDate.
		return d.toLocaleString(APP_LOCALE)
	} catch {
		return d.toISOString()
	}
}

/**
 * Format a duration in seconds as `1h 2m 3s` / `2m 3s` / `45s`. Crosses the
 * hour boundary properly (so 3712s reads as `1h 1m 52s`, not the misleading
 * `61m 52s` the old per-step formatters produced).
 *
 * @param {number} seconds
 * @param {object} [opts]
 * @param {string} [opts.zero='-'] - returned when seconds is falsy / non-positive
 * @returns {string}
 */
export function formatDurationSeconds(seconds, { zero = '-' } = {}) {
    const n = Number(seconds)
    if (!Number.isFinite(n) || n <= 0) return zero
    const total = Math.round(n)
    if (total <= 0) return zero
    if (total < 60) return `${total}s`
    const hours = Math.floor(total / 3600)
    const mins = Math.floor((total % 3600) / 60)
    const secs = total % 60
    const parts = []
    if (hours > 0) parts.push(`${hours}h`)
    if (mins > 0 || hours > 0) parts.push(`${mins}m`)
    // Drop the seconds segment past the hour mark; it's noise once you're
    // counting in hours, and the parent UI usually re-renders every second
    // anyway so the live tick stays meaningful at the minute granularity.
    if (hours === 0 && secs > 0) parts.push(`${secs}s`)
    return parts.join(' ')
}

/**
 * "in 3 days" / "in 2h" / "in 45 min". Returns null for past dates,
 * NaN, or empty input. Days are the largest unit checked; sub-day uses
 * hours; sub-hour uses minutes (minimum 1 to avoid the meaningless "in 0 min").
 */
export function formatTimeUntil(iso) {
    if (!iso) return null
    const target = parseServerTimestamp(iso)
    if (!target) return null
    const ms = target.getTime() - Date.now()
    if (Number.isNaN(ms) || ms <= 0) return null
    const d = Math.round(ms / 86_400_000)
    if (d >= 1) return `in ${d} day${d === 1 ? '' : 's'}`
    const h = Math.round(ms / 3_600_000)
    if (h >= 1) return `in ${h}h`
    const m = Math.max(1, Math.round(ms / 60_000))
    return `in ${m} min`
}

/**
 * Formats a relative time (e.g., "2 hours ago", "3 days ago")
 * @param {Date|string|number} date - The date to format
 * @returns {string} Formatted relative time string
 * @example
 * formatRelativeTime(new Date(Date.now() - 3600000)) // "1 hour ago"
 * formatRelativeTime(new Date(Date.now() - 86400000)) // "1 day ago"
 */
export function formatRelativeTime(date) {
	if (!date) return ''

	const now = new Date()
	const then = parseServerTimestamp(date)
	if (!then) return ''
	const seconds = Math.floor((now - then) / 1000)

	if (seconds < 0) return 'just now'
	if (seconds < 60) return `${seconds}s ago`

	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`

	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`

	const days = Math.floor(hours / 24)
	if (days < 30) return `${days}d ago`

	const months = Math.floor(days / 30)
	if (months < 12) return `${months}mo ago`

	const years = Math.floor(months / 12)
	return `${years}y ago`
}

/**
 * Count + noun with the right plural form: `plural(3, 'repository',
 * 'repositories')` → "3 repositories", `plural(1, 'blocker')` → "1 blocker".
 * Exists so confirmations never fall back to "3 repo(s)", which reads as
 * machine output at exactly the moment the user needs confidence.
 * @param {number} count
 * @param {string} one - singular noun
 * @param {string} [many] - plural noun (default: one + 's')
 */
export function plural(count, one, many = `${one}s`) {
	const n = Number(count) || 0
	return `${formatNumber(n)} ${n === 1 ? one : many}`
}
