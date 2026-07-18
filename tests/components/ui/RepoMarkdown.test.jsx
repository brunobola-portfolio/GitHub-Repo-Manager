import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RepoMarkdown } from '../../../src/components/ui/RepoMarkdown'

const PROPS = { owner: 'octocat', repo: 'demo', branch: 'main' }

// Own-app mermaid-fence rendering parity (Addendum 6b.1's "RepoMarkdown must
// render ```mermaid fences like WalkthroughTab does" requirement) — mocked the
// same way DiagramGenerator.test.jsx mocks the pipeline.
const mermaidRenderMock = vi.fn()
const mermaidInitializeMock = vi.fn()
vi.mock('mermaid', () => ({
    default: {
        initialize: (...args) => mermaidInitializeMock(...args),
        render: (...args) => mermaidRenderMock(...args),
    },
}))

beforeEach(() => {
    mermaidRenderMock.mockReset().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>' })
    mermaidInitializeMock.mockReset()
})

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

    it('applies a language class to fenced code blocks for known languages', async () => {
        const md = '```javascript\nconst x = 1\n```'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const code = container.querySelector('pre code')
        expect(code?.className || '').toMatch(/language-javascript/)
    })

    it('tokenizes fenced code blocks with lowlight (hljs-* spans) once the highlighter loads', async () => {
        const md = '```javascript\nconst x = 1\n```'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)

        await waitFor(() => {
            expect(container.querySelector('.hljs-keyword')).toBeTruthy()
        })
        // The tokenized text content must still equal the original source —
        // tokenizing must never lose or reorder code.
        const code = container.querySelector('pre code')
        expect(code?.textContent).toBe('const x = 1')
        expect(code?.className || '').toMatch(/\bhljs\b/)
    })

    it('leaves an unrecognized language as plain (untokenized) text without throwing', async () => {
        const md = '```not-a-real-lang\nsome text\n```'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        await waitFor(() => {
            // Highlighter has had a tick to load; no hljs-* spans should appear
            // for an unregistered language.
            expect(container.querySelector('pre code')?.textContent).toBe('some text')
        })
        expect(container.querySelector('.hljs-keyword')).toBeNull()
    })

    it('renders a copy-code button on fenced blocks that copies the exact code text', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

        const md = '```javascript\nconst x = 1\nconst y = 2\n```'
        render(<RepoMarkdown source={md} {...PROPS} />)

        const button = await screen.findByRole('button', { name: /copy code/i })
        await act(async () => { fireEvent.click(button) })

        expect(writeText).toHaveBeenCalledWith('const x = 1\nconst y = 2')
        expect(await screen.findByRole('button', { name: /copied to clipboard/i })).toBeInTheDocument()
    })

    it('does not render a copy button for inline code (only fenced blocks)', () => {
        const md = 'Run `npm install` to set up.'
        render(<RepoMarkdown source={md} {...PROPS} />)
        expect(screen.queryByRole('button', { name: /copy code/i })).toBeNull()
    })

    describe('```mermaid fence rendering (own-app diagram-embed parity)', () => {
        it('renders a ```mermaid fence as a live diagram, not a plain code block', async () => {
            const md = '```mermaid\ngraph TD\n  A --> B\n```'
            const { container } = render(<RepoMarkdown source={md} {...PROPS} />)

            await waitFor(() => expect(mermaidRenderMock).toHaveBeenCalledTimes(1))
            expect(mermaidRenderMock.mock.calls[0][1]).toBe('graph TD\n  A --> B')
            expect(await screen.findByTestId('readme-mermaid-output')).toBeInTheDocument()
            // No fenced <pre><code> for the mermaid block — it was replaced by the diagram.
            expect(container.querySelector('pre code.language-mermaid')).toBeNull()
        })

        it('still renders a normal fenced code block for a non-mermaid language', () => {
            const md = '```js\nconst x = 1\n```'
            render(<RepoMarkdown source={md} {...PROPS} />)
            expect(screen.queryByTestId('readme-mermaid-output')).toBeNull()
            expect(mermaidRenderMock).not.toHaveBeenCalled()
        })

        it('shows an inline error instead of throwing when the diagram fails to render', async () => {
            mermaidRenderMock.mockRejectedValueOnce(new Error('Parse error on line 1'))
            const md = '```mermaid\nnot valid mermaid\n```'
            render(<RepoMarkdown source={md} {...PROPS} />)

            expect(await screen.findByText(/diagram failed to render/i)).toBeInTheDocument()
        })

        it('renders diagrams embedded between the marker comments the embed flow inserts', async () => {
            const md = [
                '# acme/lib',
                '',
                'Intro paragraph.',
                '',
                '<!-- repo-manager:diagram:architecture:start -->',
                '```mermaid',
                'graph TD',
                '  A --> B',
                '```',
                '<!-- repo-manager:diagram:architecture:end -->',
            ].join('\n')
            render(<RepoMarkdown source={md} {...PROPS} />)

            await waitFor(() => expect(mermaidRenderMock).toHaveBeenCalledTimes(1))
            expect(await screen.findByTestId('readme-mermaid-output')).toBeInTheDocument()
        })
    })
})
