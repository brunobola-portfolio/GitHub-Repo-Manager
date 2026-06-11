// Dashboard hero greeting helpers.
//
// The product UI is English-only, so the greeting, subtitle and "synced"
// label are English to stay consistent with the rest of the app. A previous
// version flipped these to Portuguese for pt-* browsers while 100% of the
// rest of the ~368-component UI stayed English — which read as a
// half-finished translation (e.g. "SINCRONIZADO 2 H AGO" on the eyebrow).
// Removed until a real i18n layer exists. Date/number formatting still
// respects the user's locale via Intl elsewhere.

export function getGreeting(date, name) {
    const hour = date.getHours()
    let phrase
    if (hour >= 6 && hour < 12) phrase = 'Good morning'
    else if (hour >= 12 && hour < 18) phrase = 'Good afternoon'
    else phrase = 'Good evening'

    if (!name) return phrase
    return `${phrase}, ${name}`
}

export function getDashboardSubtitle() {
    return "Here's what needs your attention today."
}

export function getHeroFallbackGreeting() {
    return 'Hello ✨'
}

export function getSyncedLabel() {
    return 'synced'
}

export function getDashboardLocale() {
    return 'en-US'
}
