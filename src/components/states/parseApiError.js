/**
 * Maps a fetch Response (or thrown Error with .status) into a typed
 * UI-state descriptor consumed by the <FeatureState /> family.
 *
 * Server contracts honoured:
 *   - 401 / 403 with body { error: 'upgrade_required', requiredTier, currentTier }
 *     → { kind: 'upgrade-required', tier, currentTier }
 *   - 401 unauthenticated
 *     → { kind: 'unauthenticated' }
 *   - 503 with body { error: 'Billing is not configured' } or similar
 *     → { kind: 'service-unavailable', service, hint }
 *   - 429 with Retry-After
 *     → { kind: 'rate-limited', retryAfterSec }
 *   - other → { kind: 'generic', status, message }
 *
 * The descriptor is intentionally serialisable so callers can stash it
 * in component state without holding the Response object alive.
 */
export async function parseApiError(resOrError, context = {}) {
    if (resOrError && typeof resOrError === 'object' && 'status' in resOrError && 'ok' in resOrError) {
        return parseFromResponse(resOrError, context)
    }
    if (resOrError instanceof Error) {
        return { kind: 'generic', status: resOrError.status ?? 0, message: resOrError.message || 'Unexpected error' }
    }
    return { kind: 'generic', status: 0, message: 'Unknown error' }
}

async function parseFromResponse(res, context) {
    const status = res.status

    let body = null
    try {
        const cloned = res.clone()
        body = await cloned.json()
    } catch {
        // Non-JSON response — fine, we'll fall through to the status code.
    }

    if (status === 401) {
        if (body?.error === 'upgrade_required') return upgradeFromBody(body)
        return { kind: 'unauthenticated', message: body?.error || 'Sign in to continue' }
    }

    if (status === 403) {
        if (body?.error === 'upgrade_required') return upgradeFromBody(body)
        return { kind: 'forbidden', message: body?.error || body?.message || 'Access denied' }
    }

    if (status === 503) {
        return {
            kind: 'service-unavailable',
            service: context.service ?? 'this feature',
            hint: body?.error || body?.message || null,
        }
    }

    if (status === 429) {
        const headerRetry = parseInt(res.headers.get('Retry-After') ?? '', 10)
        return {
            kind: 'rate-limited',
            retryAfterSec: Number.isFinite(headerRetry) ? headerRetry : null,
            message: body?.error || 'Too many requests',
        }
    }

    return {
        kind: 'generic',
        status,
        message: body?.error || body?.message || `Request failed (${status})`,
    }
}

function upgradeFromBody(body) {
    return {
        kind: 'upgrade-required',
        tier: body.requiredTier ?? 'pro',
        currentTier: body.currentTier ?? 'free',
        message: body.message ?? null,
    }
}
