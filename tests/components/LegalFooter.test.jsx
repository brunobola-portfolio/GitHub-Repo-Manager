import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LegalFooter } from '../../src/components/LegalFooter.jsx'
import { resetSupportCache } from '../../src/utils/supportContact.js'

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

describe('LegalFooter — the complaints book (DL 74/2017)', () => {
    afterEach(() => shell(null))

    it('the BolaLabs instance shows access to the official complaints book', () => {
        shell({ salesUrl: 'https://bolalabs.pt/en/contact?topic=repomanager', complaintsBookUrl: BOOK })
        render(<LegalFooter />)
        const link = screen.getByRole('link', { name: 'Livro de Reclamações' })
        expect(link).toHaveAttribute('href', BOOK)
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('a self-hosted instance does not show BolaLabs’ entry', () => {
        shell({ salesUrl: 'https://bolalabs.pt/en/repomanager' })
        render(<LegalFooter />)
        expect(screen.queryByRole('link', { name: /livro de reclama/i })).toBeNull()
    })
})
