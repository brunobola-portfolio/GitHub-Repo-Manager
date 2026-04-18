import { describe, it, expect } from 'vitest'
import {
    sanitizeRepoDescription,
    defaultRepoDescription,
    REPO_DESCRIPTION_MAX,
} from '../lib/repo-description.js'

describe('sanitizeRepoDescription', () => {
    it('returns empty string for null/undefined', () => {
        expect(sanitizeRepoDescription(null)).toBe('')
        expect(sanitizeRepoDescription(undefined)).toBe('')
    })

    it('collapses newlines and tabs into single spaces', () => {
        expect(sanitizeRepoDescription('foo\n\tbar\n\n\nbaz')).toBe('foo bar baz')
    })

    it('strips fenced code blocks', () => {
        const input = 'Main repo ```js\nconst x = 1\n``` — core service'
        expect(sanitizeRepoDescription(input)).toBe('Main repo — core service')
    })

    it('strips inline backticks', () => {
        expect(sanitizeRepoDescription('Uses `React` and `Tailwind`')).toBe('Uses React and Tailwind')
    })

    it('strips emoji', () => {
        expect(sanitizeRepoDescription('Ship it 🚀 today 🎉')).toBe('Ship it today')
    })

    it('trims leading/trailing whitespace', () => {
        expect(sanitizeRepoDescription('   hello   ')).toBe('hello')
    })

    it('truncates on word boundary when exceeding 350 chars and appends ellipsis', () => {
        const word = 'lorem '
        const input = word.repeat(100) // 600 chars
        const out = sanitizeRepoDescription(input)
        expect(out.length).toBeLessThanOrEqual(REPO_DESCRIPTION_MAX)
        expect(out.endsWith('…')).toBe(true)
        // No mid-word cut: the char before the ellipsis must be a letter followed by nothing weird
        expect(out).toMatch(/lorem…$/)
    })

    it('does not truncate when exactly at the limit', () => {
        const input = 'x'.repeat(REPO_DESCRIPTION_MAX)
        expect(sanitizeRepoDescription(input)).toBe(input)
    })
})

describe('defaultRepoDescription', () => {
    it('composes a git description from org/project/repo', () => {
        expect(defaultRepoDescription({
            repoName: 'my-repo',
            source: { org: 'brunobola', project: 'APOS', isTfvc: false },
        })).toBe('Migrated from Azure DevOps: brunobola/APOS/my-repo')
    })

    it('composes a TFVC description stripping the $/ prefix and project segment', () => {
        expect(defaultRepoDescription({
            repoName: 'Cacadores',
            source: {
                org: 'brunobola',
                project: 'APOS - Advanced POS',
                isTfvc: true,
                tfvcPath: '$/APOS - Advanced POS/Cacadores',
            },
        })).toBe('Migrated from Azure DevOps TFVC: APOS - Advanced POS/Cacadores')
    })

    it('handles TFVC when the folder lives at the project root', () => {
        expect(defaultRepoDescription({
            repoName: 'root',
            source: {
                org: 'o', project: 'P', isTfvc: true, tfvcPath: '$/P',
            },
        })).toBe('Migrated from Azure DevOps TFVC: P')
    })

    it('degrades gracefully when fields are missing', () => {
        expect(defaultRepoDescription({})).toBe('Migrated from Azure DevOps: /')
    })
})
