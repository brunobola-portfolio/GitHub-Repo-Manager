import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

const { HeroOrgChip } = await import('../../../src/components/Dashboard/HeroOrgChip')

describe('HeroOrgChip', () => {
    it('renders selected org label', () => {
        const orgs = [{ login: 'acme', avatar_url: 'https://example.com/acme.png', public_repos: 5 }]
        render(<HeroOrgChip orgs={orgs} selectedOrg="acme" onSelectOrg={() => {}} loading={false} />)
        expect(screen.getByText('acme')).toBeInTheDocument()
    })

    it('renders "All organizations" when none selected', () => {
        render(<HeroOrgChip orgs={[]} selectedOrg="" onSelectOrg={() => {}} loading={false} />)
        expect(screen.getByText('All organizations')).toBeInTheDocument()
    })
})
