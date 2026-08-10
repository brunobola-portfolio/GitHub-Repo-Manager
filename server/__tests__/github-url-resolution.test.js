/*
 * githubApi() signs every request with the user's OAuth token, so where that
 * request goes is not a detail. The wrapper used to accept any string starting
 * with 'http' verbatim, which meant one caller passing a stored or derived URL
 * was the difference between an API call and handing a bearer token to another
 * host.
 */
import { describe, it, expect } from 'vitest'
import { resolveGitHubUrl, GITHUB_API_ORIGIN } from '../lib/github-api.js'

describe('resolveGitHubUrl', () => {
    it('roots a relative path on the GitHub API', () => {
        expect(resolveGitHubUrl('/user/repos')).toBe('https://api.github.com/user/repos')
        expect(resolveGitHubUrl('/repos/o/r/pulls?state=open'))
            .toBe('https://api.github.com/repos/o/r/pulls?state=open')
    })

    it('accepts an absolute URL only on api.github.com', () => {
        expect(resolveGitHubUrl(`${GITHUB_API_ORIGIN}/user`)).toBe('https://api.github.com/user')
    })

    it.each([
        ['https://evil.example/user', 'another host'],
        ['https://api.github.com.evil.example/user', 'suffix confusion'],
        ['http://api.github.com/user', 'plaintext downgrade'],
        ['//evil.example/user', 'protocol-relative'],
        ['file:///etc/passwd', 'non-http scheme'],
        ['https://user:pass@evil.example/', 'credentials in authority'],
    ])('refuses %s (%s)', (url) => {
        expect(() => resolveGitHubUrl(url)).toThrow()
        try {
            resolveGitHubUrl(url)
        } catch (err) {
            expect(err.status).toBe(400)
        }
    })

    it('rejects a path that is neither rooted nor absolute', () => {
        expect(() => resolveGitHubUrl('user/repos')).toThrow(/must start with/)
        expect(() => resolveGitHubUrl('')).toThrow()
        expect(() => resolveGitHubUrl(null)).toThrow()
    })
})
