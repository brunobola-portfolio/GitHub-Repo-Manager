import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UpgradeRequired } from '@/components/states/UpgradeRequired'

/*
 * Regression coverage: the router only registers the `#/pricing` hash
 * (src/hooks/useAppRouter.js). UpgradeRequired used to default `pricingHref`
 * to the bare `#pricing`, which the router silently ignores — making the
 * sole CTA on every tier-gated surface that renders this component
 * (card/inline/banner) a dead link whenever the caller didn't override it
 * (no caller did).
 */
describe('UpgradeRequired — pricing CTA hash', () => {
    it('defaults the card-variant CTA href to the registered #/pricing hash', () => {
        render(<UpgradeRequired feature="Stale PRs" />)
        expect(screen.getByRole('link')).toHaveAttribute('href', '#/pricing')
    })

    it('defaults the inline-variant CTA href to the registered #/pricing hash', () => {
        render(<UpgradeRequired variant="inline" feature="Stale PRs" />)
        expect(screen.getByRole('link')).toHaveAttribute('href', '#/pricing')
    })

    it('defaults the banner-variant CTA href to the registered #/pricing hash', () => {
        render(<UpgradeRequired variant="banner" feature="Stale PRs" />)
        expect(screen.getByRole('link')).toHaveAttribute('href', '#/pricing')
    })

    it('still honors an explicit pricingHref override (no other navigation behavior changed)', () => {
        render(<UpgradeRequired feature="Stale PRs" pricingHref="/billing" />)
        expect(screen.getByRole('link')).toHaveAttribute('href', '/billing')
    })
})
