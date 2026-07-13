import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeatureState } from '@/components/states/FeatureState'

/*
 * Regression coverage: FeatureState is the single dispatcher every
 * tier-gated tab/panel uses to render an 'upgrade-required' error — it used
 * to default `pricingHref` to the bare `#pricing`, which the router
 * (src/hooks/useAppRouter.js) silently ignores because only `#/pricing` is
 * registered. No caller overrode the default (grep-verified), so the CTA was
 * a dead link on every gated Work Board tab / Settings panel.
 */
describe('FeatureState — pricing CTA hash', () => {
    it('defaults the upgrade-required CTA href to the registered #/pricing hash', () => {
        render(
            <FeatureState
                error={{ kind: 'upgrade-required', tier: 'pro' }}
                feature="Stale PRs"
            />
        )
        expect(screen.getByRole('link')).toHaveAttribute('href', '#/pricing')
    })

    it('still honors an explicit pricingHref override (no other navigation behavior changed)', () => {
        render(
            <FeatureState
                error={{ kind: 'upgrade-required', tier: 'pro' }}
                feature="Stale PRs"
                pricingHref="/billing"
            />
        )
        expect(screen.getByRole('link')).toHaveAttribute('href', '/billing')
    })
})
