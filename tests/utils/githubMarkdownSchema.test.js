import { describe, it, expect } from 'vitest'
import { defaultSchema } from 'rehype-sanitize'
import { buildGitHubSchema } from '../../src/utils/githubMarkdownSchema'

describe('buildGitHubSchema', () => {
    it('namespaces ids with the caller prefix', () => {
        expect(buildGitHubSchema('readme-').clobberPrefix).toBe('readme-')
        expect(buildGitHubSchema('user-content-').clobberPrefix).toBe('user-content-')
    })

    it('adds only the attributes GitHub content uses, on top of the default', () => {
        const s = buildGitHubSchema('x-')
        expect(s.attributes.img).toEqual(expect.arrayContaining(['width', 'height', 'align']))
        expect(s.attributes.details).toContain('open')
        expect(s.attributes.h2).toContain('id')
        // Nothing that runs code or styles the page.
        for (const list of Object.values(s.attributes)) {
            for (const a of list) {
                const name = Array.isArray(a) ? a[0] : a
                expect(name).not.toMatch(/^on|^style$/i)
            }
        }
        expect(s.tagNames).toEqual(defaultSchema.tagNames)
    })
})
