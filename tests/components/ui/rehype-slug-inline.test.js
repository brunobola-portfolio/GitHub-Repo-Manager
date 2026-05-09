import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'
import { rehypeSlugInline } from '../../../src/components/ui/__rehype-slug-inline'

async function process(html) {
    const file = await unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeSlugInline)
        .use(rehypeStringify)
        .process(html)
    return String(file)
}

describe('rehypeSlugInline', () => {
    it('adds an id derived from heading text', async () => {
        const out = await process('<h2>My Section</h2>')
        expect(out).toContain('id="my-section"')
    })
    it('lowercases and strips punctuation', async () => {
        const out = await process('<h3>Hello, World! (v2)</h3>')
        expect(out).toContain('id="hello-world-v2"')
    })
    it('preserves an existing id', async () => {
        const out = await process('<h2 id="custom">Title</h2>')
        expect(out).toContain('id="custom"')
    })
    it('handles all heading levels h1-h6', async () => {
        for (const level of [1, 2, 3, 4, 5, 6]) {
            const out = await process(`<h${level}>Sec</h${level}>`)
            expect(out).toContain('id="sec"')
        }
    })
    it('strips leading and trailing hyphens from the slug', async () => {
        const out = await process('<h2>- Leading and trailing -</h2>')
        expect(out).toContain('id="leading-and-trailing"')
    })
})
