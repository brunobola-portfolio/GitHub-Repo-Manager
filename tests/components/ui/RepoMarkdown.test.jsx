import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RepoMarkdown } from '../../../src/components/ui/RepoMarkdown'

const PROPS = { owner: 'octocat', repo: 'demo', branch: 'main' }

describe('RepoMarkdown', () => {
    it('renders GFM tables', () => {
        const md = `| a | b |\n|---|---|\n| 1 | 2 |`
        render(<RepoMarkdown source={md} {...PROPS} />)
        expect(screen.getByRole('table')).toBeInTheDocument()
        expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument()
    })

    it('renders fenced code blocks (no <pre> wrapping the entire document)', () => {
        const md = '```js\nconst x = 1\n```'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        expect(container.firstChild?.tagName).not.toBe('PRE')
        expect(container.querySelector('pre code')).toBeTruthy()
    })

    it('rewrites a relative <img src> to raw.githubusercontent.com', () => {
        const md = '![banner](./banner.png)'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const img = container.querySelector('img')
        expect(img?.getAttribute('src')).toBe(
            'https://raw.githubusercontent.com/octocat/demo/main/banner.png',
        )
    })

    it('rewrites a relative markdown link to github.com/.../blob/...', () => {
        const md = '[docs](./docs/x.md)'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const a = container.querySelector('a')
        expect(a?.getAttribute('href')).toBe(
            'https://github.com/octocat/demo/blob/main/docs/x.md',
        )
    })

    it('lets absolute URLs pass through unchanged (fragment hrefs get readme- prefix)', () => {
        const md = '[anchor](#section) and [absolute](https://example.com/x)'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const links = container.querySelectorAll('a')
        expect(links[0]?.getAttribute('href')).toBe('#readme-section')
        expect(links[1]?.getAttribute('href')).toBe('https://example.com/x')
    })

    it('preserves <div align="center"> from raw HTML', () => {
        const md = '<div align="center">Banner</div>'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const div = container.querySelector('div[align="center"]')
        expect(div).toBeTruthy()
    })

    it('strips <script> tags via sanitize', () => {
        const md = 'Hello <script>alert(1)</script> world'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        expect(container.querySelector('script')).toBeNull()
    })

    it('adds id slugs to headings (namespaced via readme- prefix)', () => {
        const md = '# Hello World'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        expect(container.querySelector('h1')?.id).toBe('readme-hello-world')
    })

    it('namespaces HTML-supplied ids so they cannot collide with app shell ids', () => {
        const md = '<h1 id="root">Trying to clobber</h1>'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const h1 = container.querySelector('h1')
        expect(h1?.id).toBe('readme-root') // NOT just "root"
        expect(h1?.id).not.toBe('root')
    })

    it('prefixes fragment-link hrefs so in-README anchors keep working', () => {
        const md = '[jump](#hello-world)\n\n# Hello World'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const a = container.querySelector('a')
        expect(a?.getAttribute('href')).toBe('#readme-hello-world')
    })

    it('applies a Shiki language class to fenced code blocks for known languages', async () => {
        const md = '```javascript\nconst x = 1\n```'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        // Shiki renders inline-styled spans; we don't assert exact tokens (theme-
        // dependent), only that the language class survived.
        const code = container.querySelector('pre code')
        expect(code?.className || '').toMatch(/language-javascript/)
    })
})
