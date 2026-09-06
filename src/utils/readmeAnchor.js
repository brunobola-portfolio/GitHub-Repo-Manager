// A README's own "#section" links (namespaced to #readme-* by the sanitizer)
// and the table of contents both point inside the page. Letting the browser
// follow them replaced the app's route hash with #readme-…, so a reload after
// one click landed on the dashboard — and target=_blank on the README links
// opened the same page in a new tab. Scroll instead and leave the URL alone.
export function scrollToReadmeAnchor(id) {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null
    if (!el) return false
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (typeof el.focus === 'function') {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
        el.focus({ preventScroll: true })
    }
    return true
}
