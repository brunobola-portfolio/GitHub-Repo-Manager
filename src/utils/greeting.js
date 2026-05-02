// Locale-aware greeting helper. README promises a personalised greeting
// in the user's language ("Bom dia" for pt-* locales, "Good morning"
// otherwise) — defaulting to the browser's language so the hero copy
// stays consistent with the rest of the (English) UI for non-PT users.

function detectLocale() {
    if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
    return 'en-US'
}

function isPortuguese(locale) {
    return typeof locale === 'string' && locale.toLowerCase().startsWith('pt')
}

export function getGreeting(date, name, locale = detectLocale()) {
    const pt = isPortuguese(locale)
    const hour = date.getHours()
    let phrase
    if (hour >= 6 && hour < 12) phrase = pt ? 'Bom dia' : 'Good morning'
    else if (hour >= 12 && hour < 18) phrase = pt ? 'Boa tarde' : 'Good afternoon'
    else phrase = pt ? 'Boa noite' : 'Good evening'

    if (!name) return phrase
    return `${phrase}, ${name}`
}

export function getDashboardSubtitle(locale = detectLocale()) {
    return isPortuguese(locale)
        ? 'Aqui está o que precisa de ti hoje.'
        : "Here's what needs your attention today."
}

export function getHeroFallbackGreeting(locale = detectLocale()) {
    return isPortuguese(locale) ? 'Olá ✨' : 'Hello ✨'
}

export function getSyncedLabel(locale = detectLocale()) {
    return isPortuguese(locale) ? 'sincronizado' : 'synced'
}

export function getDashboardLocale(locale = detectLocale()) {
    return isPortuguese(locale) ? 'pt-PT' : 'en-US'
}
