import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LandingPage } from '@/components/Landing/LandingPage'
import { resetSupportCache } from '@/utils/supportContact'
import { ThemeProvider } from '@/hooks/useTheme'

const BOOK = 'https://www.livroreclamacoes.pt/Inicio/'

function shell(support) {
  document.head.querySelectorAll('meta[name="grm-support"]').forEach((m) => m.remove())
  if (support) {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'grm-support')
    meta.setAttribute('content', JSON.stringify(support))
    document.head.appendChild(meta)
  }
  resetSupportCache()
}

const renderLanding = () =>
  render(
    <ThemeProvider>
      <LandingPage onSignIn={() => {}} />
    </ThemeProvider>,
  )

// The landing page is what a visitor sees before buying, so the access the
// law asks of a seller has to be here, not only in the signed-in app.
describe('LandingPage footer — the complaints book (DL 74/2017)', () => {
  afterEach(() => shell(null))

  it('the BolaLabs instance links the official complaints book', () => {
    shell({ salesUrl: 'https://bolalabs.pt/en/contact?topic=repomanager', complaintsBookUrl: BOOK })
    renderLanding()
    const link = screen.getByRole('link', { name: 'Livro de Reclamações' })
    expect(link).toHaveAttribute('href', BOOK)
    expect(link).toHaveAttribute('lang', 'pt')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('a self-hosted instance does not show BolaLabs’ entry', () => {
    shell({ salesUrl: 'https://bolalabs.pt/en/repomanager' })
    renderLanding()
    expect(screen.queryByRole('link', { name: /livro de reclama/i })).toBeNull()
  })
})
