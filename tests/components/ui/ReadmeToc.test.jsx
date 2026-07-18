import { useRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReadmeToc } from '../../../src/components/ui/ReadmeToc'

// ReadmeToc walks the *rendered* DOM inside containerRef — render real
// heading markup into a ref-bearing container the way OverviewTab does
// (RepoMarkdown output sits next to it, not inside it).
function Harness({ headingsHtml, source = 'v1' }) {
    const containerRef = useRef(null)
    return (
        <div>
            <div ref={containerRef} dangerouslySetInnerHTML={{ __html: headingsHtml }} />
            <ReadmeToc containerRef={containerRef} source={source} />
        </div>
    )
}

const TWO_HEADINGS = `
    <h1 id="readme-intro">Intro</h1>
    <p>Some text</p>
    <h2 id="readme-usage">Usage</h2>
`

describe('ReadmeToc', () => {
    it('renders nothing when the README has fewer than 2 headings', () => {
        const { container } = render(<Harness headingsHtml='<h1 id="readme-only">Only heading</h1>' />)
        expect(container.querySelector('[data-testid="readme-toc"]')).toBeNull()
    })

    it('renders one entry per heading, linking to its readme- namespaced id', async () => {
        render(<Harness headingsHtml={TWO_HEADINGS} />)

        const nav = await screen.findByTestId('readme-toc')
        expect(nav).toHaveAttribute('aria-label', 'On this page')

        const introLink = screen.getByRole('link', { name: 'Intro' })
        expect(introLink).toHaveAttribute('href', '#readme-intro')
        const usageLink = screen.getByRole('link', { name: 'Usage' })
        expect(usageLink).toHaveAttribute('href', '#readme-usage')
    })

    it('marks the first heading active by default', async () => {
        render(<Harness headingsHtml={TWO_HEADINGS} />)
        const introLink = await screen.findByRole('link', { name: 'Intro' })
        expect(introLink).toHaveAttribute('aria-current', 'location')
        const usageLink = screen.getByRole('link', { name: 'Usage' })
        expect(usageLink).not.toHaveAttribute('aria-current')
    })

    it('collapses the list when the header toggle is clicked, keeping the nav itself visible', async () => {
        const { default: userEvent } = await import('@testing-library/user-event')
        render(<Harness headingsHtml={TWO_HEADINGS} />)

        const toggle = await screen.findByRole('button', { name: /on this page/i })
        expect(screen.getByRole('link', { name: 'Intro' })).toBeInTheDocument()

        const user = userEvent.setup()
        await user.click(toggle)

        expect(screen.queryByRole('link', { name: 'Intro' })).toBeNull()
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('re-scans headings when `source` changes', async () => {
        const { rerender } = render(<Harness headingsHtml='<h1 id="readme-only">Only heading</h1>' source="v1" />)
        expect(screen.queryByTestId('readme-toc')).toBeNull()

        rerender(<Harness headingsHtml={TWO_HEADINGS} source="v2" />)
        expect(await screen.findByTestId('readme-toc')).toBeInTheDocument()
    })
})
