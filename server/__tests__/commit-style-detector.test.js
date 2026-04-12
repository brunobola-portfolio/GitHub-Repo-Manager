import { describe, it, expect } from 'vitest'
import { detectCommitStyle } from '../lib/commit-style-detector.js'

describe('detectCommitStyle', () => {
    it('detects conventional commits', () => {
        const messages = [
            'feat(auth): add login endpoint',
            'fix(api): handle 404 errors',
            'chore: update dependencies',
            'refactor(db): extract query builder',
            'feat: add user registration',
        ]
        const result = detectCommitStyle(messages)
        expect(result.detected_style).toBe('conventional')
        expect(result.pattern).toBe('type(scope): description')
        expect(result.confidence).toBeGreaterThan(0.6)
        expect(result.prefixes).toHaveProperty('feat')
    })

    it('detects gitmoji style', () => {
        const messages = [
            ':sparkles: add new feature',
            ':bug: fix login bug',
            ':recycle: refactor auth module',
            ':memo: update readme',
            ':art: improve code style',
        ]
        const result = detectCommitStyle(messages)
        expect(result.detected_style).toBe('gitmoji')
        expect(result.confidence).toBeGreaterThan(0.6)
    })

    it('detects JIRA prefix style', () => {
        const messages = [
            'PROJ-123 fix login issue',
            'PROJ-456 add user registration',
            'PROJ-789 update dependencies',
            'PROJ-101 refactor auth',
            'PROJ-202 add tests',
        ]
        const result = detectCommitStyle(messages)
        expect(result.detected_style).toBe('jira-prefix')
        expect(result.pattern).toContain('PROJ-')
    })

    it('returns descriptive for unrecognized patterns', () => {
        const messages = [
            'Added login functionality',
            'Fixed the bug in auth',
            'Updated the readme file',
            'Removed old code',
            'Changed the config',
        ]
        const result = detectCommitStyle(messages)
        expect(result.detected_style).toBe('descriptive')
        expect(result.confidence).toBeLessThan(0.5)
    })

    it('handles empty array', () => {
        const result = detectCommitStyle([])
        expect(result.detected_style).toBe('descriptive')
        expect(result.confidence).toBe(0)
        expect(result.examples).toEqual([])
    })

    it('returns top 3 examples', () => {
        const messages = Array.from({ length: 20 }, (_, i) => `feat: change ${i}`)
        const result = detectCommitStyle(messages)
        expect(result.examples).toHaveLength(3)
    })
})
