import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroSection } from '@/components/Landing/HeroSection'

describe('HeroSection — version badge', () => {
  it('renders the build-injected version, never a hardcoded literal', () => {
    render(<HeroSection onSignIn={() => {}} />)

    // The define in vite.config.js / vitest.config.js must resolve, otherwise
    // the badge would read "vundefined".
    const version = import.meta.env.VITE_APP_VERSION
    expect(version).toBeTruthy()

    const escaped = version.replace(/\./g, '\\.')
    expect(screen.getByText(new RegExp(`v${escaped}`))).toBeInTheDocument()
    // Guard against the stale v2.5 literal creeping back.
    expect(screen.queryByText(/·\s*v2\.5\b/)).not.toBeInTheDocument()
  })
})
