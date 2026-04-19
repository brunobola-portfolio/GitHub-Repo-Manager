/**
 * Time constants and helpers.
 *
 * Centralizes the `1000 * 60 * 60 * 24`-style magic literals that were
 * previously duplicated across Dashboard, MigrationWizard, LicenseBadge,
 * PRReview, ActivityTab, OrganizationCard and Sidebar.
 *
 * ALL math in milliseconds. Import whichever constant you need — never
 * re-derive.
 */

export const MS_PER_SECOND = 1000
export const MS_PER_MINUTE = 60 * MS_PER_SECOND
export const MS_PER_HOUR = 60 * MS_PER_MINUTE
export const MS_PER_DAY = 24 * MS_PER_HOUR
export const MS_PER_WEEK = 7 * MS_PER_DAY

/**
 * Calendar-ish helpers — these treat a month/year as a fixed-length bucket,
 * which is what pretty much every "days since" / "time ago" UI wants.
 * If you need true calendar math, use a library or Date manipulation.
 */
export const MS_PER_MONTH = 30 * MS_PER_DAY
export const MS_PER_YEAR = 365 * MS_PER_DAY

/**
 * Days between `date` and now (date first → negative if in future).
 * Returns a number (may be fractional). Safe for null / invalid input.
 */
export function daysSince(date) {
    if (date == null) return NaN
    const ts = date instanceof Date ? date.getTime() : new Date(date).getTime()
    if (isNaN(ts)) return NaN
    return (Date.now() - ts) / MS_PER_DAY
}

/** Hours between `date` and now. See daysSince for semantics. */
export function hoursSince(date) {
    if (date == null) return NaN
    const ts = date instanceof Date ? date.getTime() : new Date(date).getTime()
    if (isNaN(ts)) return NaN
    return (Date.now() - ts) / MS_PER_HOUR
}
