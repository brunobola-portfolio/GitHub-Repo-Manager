/**
 * Premium state primitives for empty/blocked/errored views.
 *
 *   <UpgradeRequired tier="pro" feature="Stale PRs" />
 *   <ServiceUnavailable service="Stripe billing" reason="…" />
 *   <FeatureError tone="warn" title="Too many requests" />
 *   <FeatureState error={parseApiError(res)} onRetry={refetch} />
 */
export { UpgradeRequired } from './UpgradeRequired'
export { ServiceUnavailable } from './ServiceUnavailable'
export { FeatureError } from './FeatureError'
export { FeatureState } from './FeatureState'
export { parseApiError } from './parseApiError'
