import { UpgradeRequired } from './UpgradeRequired'
import { ServiceUnavailable } from './ServiceUnavailable'
import { FeatureError } from './FeatureError'
import { SUPPORT_EMAIL } from '../../utils/supportContact'

/**
 * Renders the right empty/error state for a parsed API descriptor.
 *
 *   const [error, setError] = useState(null)
 *   ...
 *   if (error) return <FeatureState error={error} feature="Audit log"
 *                                   onRetry={refetch} />
 *
 * Single-component dispatch keeps consumers terse without duplicating
 * the "if 403 → UpgradeRequired, if 503 → ServiceUnavailable, …" decision tree.
 */
export function FeatureState({
    error,
    feature,
    benefits,
    onRetry,
    contactEmail = SUPPORT_EMAIL,
    contactSubject,
    docsHref,
    pricingHref = '#/pricing',
    onPricingClick,
    variant = 'card',
    className,
}) {
    if (!error) return null

    switch (error.kind) {
        case 'upgrade-required':
            return (
                <UpgradeRequired
                    tier={error.tier}
                    feature={feature}
                    benefits={benefits}
                    pricingHref={pricingHref}
                    onPricingClick={onPricingClick}
                    variant={variant}
                    className={className}
                />
            )

        case 'service-unavailable':
            return (
                <ServiceUnavailable
                    service={error.service ?? feature ?? 'this feature'}
                    reason={error.hint ?? undefined}
                    docsHref={docsHref}
                    contactEmail={contactEmail}
                    contactSubject={contactSubject}
                    variant={variant}
                    className={className}
                />
            )

        case 'rate-limited':
            return (
                <FeatureError
                    tone="warn"
                    title="Too many requests"
                    hint={error.retryAfterSec
                        ? 'Slow down a touch — the server is throttling.'
                        : 'Try again shortly.'}
                    retryAfterSec={error.retryAfterSec ?? undefined}
                    onRetry={onRetry}
                    variant={variant === 'inline' ? 'inline' : 'card'}
                    className={className}
                />
            )

        case 'unauthenticated':
            return (
                <FeatureError
                    tone="info"
                    title="Sign in to continue"
                    hint="Your session has expired. Sign in again to view this content."
                    variant={variant === 'inline' ? 'inline' : 'card'}
                    className={className}
                />
            )

        case 'forbidden':
            return (
                <FeatureError
                    tone="error"
                    title="Access denied"
                    hint={error.message}
                    variant={variant === 'inline' ? 'inline' : 'card'}
                    className={className}
                />
            )

        case 'generic':
        default:
            return (
                <FeatureError
                    tone={error.status >= 500 ? 'error' : 'warn'}
                    title={
                        error.status >= 500
                            ? "Something went wrong on our side"
                            : "Couldn't load this view"
                    }
                    hint={error.message}
                    onRetry={onRetry}
                    variant={variant === 'inline' ? 'inline' : 'card'}
                    className={className}
                />
            )
    }
}
