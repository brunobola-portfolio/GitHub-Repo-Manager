/**
 * Centralised dispatchers for the global `app:*` CustomEvent vocabulary.
 *
 * App.jsx owns the listeners (see the `useEffect` blocks at top-level). Any
 * component that wants to navigate the user without prop-drilling a router
 * should import these helpers rather than re-implementing
 * `window.dispatchEvent(...)` locally — that pattern already produced four
 * divergent copies of `openAISettings()` before this module existed.
 */

/**
 * Open the Settings modal at a specific tab. Matches the App.jsx listener
 * which forwards the `tab` detail to `openModalWithData('showSettings', ...)`.
 */
export function openAppSettings(tab = 'general') {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('app:open-settings', { detail: { tab } }))
}

/**
 * Convenience for the most common case — opening Settings on the AI tab so
 * the user can configure or fix BYOK / provider connection.
 */
export function openAISettings() {
    openAppSettings('ai')
}

/**
 * Navigate to the Pricing view. Uses a separate event from `app:open-billing`
 * so future flows that distinguish "see plans" vs "manage subscription" can
 * split cleanly without breaking either dispatcher.
 *
 * @param {string} [focus] Optional tier id ('pro' | 'enterprise' | …) the
 *   pricing view should highlight. Forwarded as `detail.focus` so the App
 *   listener can scroll/highlight without each caller re-encoding the contract.
 */
export function navigateToPricing(focus) {
    if (typeof window === 'undefined') return
    const detail = focus ? { focus } : undefined
    window.dispatchEvent(new CustomEvent('app:navigate-pricing', detail ? { detail } : undefined))
}

/**
 * Dispatched when a user hits an upgrade-required error (action.type ===
 * 'upgrade'). App.jsx routes this to the Pricing view, same destination as
 * `navigateToPricing` — but the event name is preserved so a "billing
 * portal" deep-link surface can adopt it later without renaming callsites.
 */
export function openBilling() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('app:open-billing'))
}
