import { useEffect, useRef } from 'react'

/**
 * Application event bus.
 *
 * A single module-level emitter that replaces the ad-hoc `window` CustomEvent
 * vocabulary which used to wire disconnected React trees together. It keeps the
 * "any tree can talk to any tree" reach of a global bus, but over an explicit,
 * name-checked, unit-testable channel instead of the DOM:
 *
 *   - emitAppEvent(name, detail)  — publish
 *   - onAppEvent(name, handler)   — subscribe; returns an unsubscribe fn
 *   - useAppEvent(name, handler)  — React subscription with effect cleanup
 *
 * Handlers receive a `{ detail }` payload, mirroring the old `CustomEvent.detail`
 * (with `detail` defaulting to `null` exactly as `new CustomEvent(name)` did), so
 * existing handler bodies that read `e.detail` keep working unchanged.
 *
 * Use the `APP_EVENTS` constants rather than raw strings — a typo then fails at
 * import time instead of silently never firing.
 */

export const APP_EVENTS = Object.freeze({
  // ai-assistant
  AI_ASSISTANT_INJECT_MESSAGE: 'ai-assistant:inject-message',
  AI_ASSISTANT_OPEN: 'ai-assistant:open',

  // app — navigation + global surfaces
  GENERATE_PR_DESCRIPTION: 'app:generate-pr-description',
  LICENSE_CHANGED: 'app:license-changed',
  NAVIGATE_DASHBOARD: 'app:navigate-dashboard',
  NAVIGATE_PRICING: 'app:navigate-pricing',
  OPEN_AI_POLISH: 'app:open-ai-polish',
  OPEN_BILLING: 'app:open-billing',
  OPEN_ISSUE_DETAIL: 'app:open-issue-detail',
  OPEN_PR_DETAIL: 'app:open-pr-detail',
  OPEN_REPO_DETAIL: 'app:open-repo-detail',
  OPEN_REPO_ISSUE: 'app:open-repo-issue',
  OPEN_REPO_PR: 'app:open-repo-pr',
  OPEN_REPO_SETTINGS: 'app:open-repo-settings',
  OPEN_SETTINGS: 'app:open-settings',
  PLAN_ISSUE_WITH_AI: 'app:plan-issue-with-ai',
  SHOW_ONBOARDING: 'app:show-onboarding',
  SHOW_QUOTA_EXCEEDED: 'app:show-quota-exceeded',
  START_PR_REVIEW: 'app:start-pr-review',
  UNHANDLED_ERROR: 'app:unhandled-error',

  // code-review surface
  CODE_REVIEW_SELECT_FILE: 'code-review-surface:select-file',

  // diff collapser
  DIFF_COLLAPSE_ALL: 'diff-collapser:collapse-all',
  DIFF_EXPAND_ALL: 'diff-collapser:expand-all',

  // migration
  MIGRATION_COMPLETE: 'migration:complete',

  // pr-review
  PR_REVIEW_APPROVE: 'pr-review:approve',
  PR_REVIEW_BLURRED: 'pr-review:blurred',
  PR_REVIEW_COMMENT: 'pr-review:comment',
  PR_REVIEW_COMPOSER_CLOSE: 'pr-review:composer-close',
  PR_REVIEW_COMPOSER_OPEN: 'pr-review:composer-open',
  PR_REVIEW_FOCUSED: 'pr-review:focused',
  PR_REVIEW_REQUEST_CHANGES: 'pr-review:request-changes',
  PR_REVIEW_SHOW_HELP: 'pr-review:show-help',
  PR_REVIEW_TOGGLE_REVIEWED: 'pr-review:toggle-reviewed',
  PR_REVIEW_TOGGLE_TREE: 'pr-review:toggle-tree',

  // repo-detail
  REPO_DETAIL_BRANCHES_LOADED: 'repo-detail:branches-loaded',
  REPO_DETAIL_ISSUES_LOADED: 'repo-detail:issues-loaded',
  REPO_DETAIL_PLAN_ISSUE: 'repo-detail:plan-issue',
  REPO_DETAIL_PRS_LOADED: 'repo-detail:prs-loaded',
  REPO_DETAIL_SELECT_ISSUE: 'repo-detail:select-issue',
  REPO_DETAIL_SELECT_PR: 'repo-detail:select-pr',

  // workboard
  WORKBOARD_AI_REGENERATE_INTERNAL: 'workboard:ai-regenerate-internal',
  WORKBOARD_CLEAR_FILTERS: 'workboard:clear-filters',
  WORKBOARD_GO_TAB: 'workboard:go-tab',
  WORKBOARD_REFRESH_ALL: 'workboard:refresh-all',
  WORKBOARD_REGENERATE_AI: 'workboard:regenerate-ai',
  WORKBOARD_SAVE_PRESET: 'workboard:save-preset',
  WORKBOARD_TOGGLE_MUTED: 'workboard:toggle-muted',
})

/** name -> Set<handler> */
const registry = new Map()

/**
 * Publish an event. Handlers receive `{ detail }`. A handler that throws does
 * not stop the others (mirrors independent DOM listeners); the error is
 * re-thrown asynchronously so it still reaches the global error handler.
 *
 * @param {string} name
 * @param {*} [detail]
 */
export function emitAppEvent(name, detail) {
  const set = registry.get(name)
  if (!set || set.size === 0) return
  const payload = { detail: detail ?? null }
  // Snapshot so a handler that (un)subscribes mid-dispatch can't corrupt iteration.
  for (const handler of [...set]) {
    try {
      handler(payload)
    } catch (err) {
      setTimeout(() => { throw err }, 0)
    }
  }
}

/**
 * Subscribe to an event.
 *
 * @param {string} name
 * @param {(payload: { detail: * }) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onAppEvent(name, handler) {
  let set = registry.get(name)
  if (!set) {
    set = new Set()
    registry.set(name, set)
  }
  set.add(handler)
  return () => {
    const current = registry.get(name)
    if (!current) return
    current.delete(handler)
    if (current.size === 0) registry.delete(name)
  }
}

/**
 * Subscribe to an app event for a component's lifetime. The latest `handler` is
 * always used (no memoization needed) and the subscription is rebound only when
 * `name` changes.
 *
 * @param {string} name
 * @param {(payload: { detail: * }) => void} handler
 */
export function useAppEvent(name, handler) {
  const handlerRef = useRef(handler)
  useEffect(() => { handlerRef.current = handler }, [handler])
  useEffect(() => onAppEvent(name, (payload) => handlerRef.current?.(payload)), [name])
}

// ----------------------------------------------------------------------------
// Named dispatch helpers (kept so navigation call sites stay declarative).
// ----------------------------------------------------------------------------

/** Open the Settings modal at a specific tab. */
export function openAppSettings(tab = 'general') {
  emitAppEvent(APP_EVENTS.OPEN_SETTINGS, { tab })
}

/** Open Settings on the AI tab (configure / fix BYOK / provider connection). */
export function openAISettings() {
  openAppSettings('ai')
}

/**
 * Navigate to the Pricing view.
 * @param {string} [focus] Optional tier id to highlight ('pro' | 'enterprise' | …).
 */
export function navigateToPricing(focus) {
  emitAppEvent(APP_EVENTS.NAVIGATE_PRICING, focus ? { focus } : undefined)
}

/** Dispatched on an upgrade-required error; App routes it to Pricing. */
export function openBilling() {
  emitAppEvent(APP_EVENTS.OPEN_BILLING)
}
