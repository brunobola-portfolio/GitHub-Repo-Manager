import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GitHubMarkdown } from '@/components/ui/GitHubMarkdown'

/*
 * PR and issue bodies come straight from GitHub, where tables, task lists and
 * inline HTML (<details>, <summary>, <img align>) are the norm — dependabot
 * bodies use all of them. Rendering them through bare react-markdown printed
 * the raw pipes and escaped tags as text.
 */
describe('GitHubMarkdown', () => {
    it('renders GFM tables as real tables', () => {
        render(<GitHubMarkdown>{'| Package | From |\n| --- | --- |\n| dompurify | 3.4.14 |'}</GitHubMarkdown>)
        expect(screen.getByRole('table')).toBeInTheDocument()
        expect(screen.getByRole('cell', { name: 'dompurify' })).toBeInTheDocument()
    })

    it('renders inline <details>/<summary> HTML instead of escaping it', () => {
        const { container } = render(
            <GitHubMarkdown>{'<details>\n<summary>Release notes</summary>\n<p>Body</p>\n</details>'}</GitHubMarkdown>
        )
        expect(container.querySelector('details')).not.toBeNull()
        expect(container.querySelector('summary')?.textContent).toBe('Release notes')
        expect(container.textContent).not.toContain('<details>')
    })

    it('strips script and event handlers', () => {
        const { container } = render(
            <GitHubMarkdown>{'<img src="x" onerror="alert(1)"><script>alert(1)</script>ok'}</GitHubMarkdown>
        )
        expect(container.querySelector('script')).toBeNull()
        expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull()
        expect(container.textContent).toContain('ok')
    })

    it('opens links in a new tab with a safe rel', () => {
        render(<GitHubMarkdown>{'[releases](https://example.com)'}</GitHubMarkdown>)
        const a = screen.getByRole('link', { name: 'releases' })
        expect(a).toHaveAttribute('target', '_blank')
        expect(a.getAttribute('rel')).toContain('noopener')
    })

    it('renders nothing for an empty body', () => {
        const { container } = render(<GitHubMarkdown>{''}</GitHubMarkdown>)
        expect(container.firstChild).toBeNull()
    })
})
