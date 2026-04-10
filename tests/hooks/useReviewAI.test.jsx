import { describe, it, expect } from 'vitest'
import { heuristicRisk } from '@/components/PRReview/hooks/useReviewAI'

describe('heuristicRisk', () => {
    it('scores auth-related files high', () => {
        expect(heuristicRisk({ filename: 'src/auth/middleware.js', additions: 0, deletions: 0 })).toBeGreaterThanOrEqual(3)
        expect(heuristicRisk({ filename: 'server/middleware/auth.js', additions: 0, deletions: 0 })).toBeGreaterThanOrEqual(3)
        expect(heuristicRisk({ filename: 'lib/session.js', additions: 0, deletions: 0 })).toBeGreaterThanOrEqual(3)
        expect(heuristicRisk({ filename: 'utils/crypto.js', additions: 0, deletions: 0 })).toBeGreaterThanOrEqual(3)
        expect(heuristicRisk({ filename: 'config/token.js', additions: 0, deletions: 0 })).toBeGreaterThanOrEqual(3)
        expect(heuristicRisk({ filename: 'helpers/password.js', additions: 0, deletions: 0 })).toBeGreaterThanOrEqual(3)
    })

    it('scores lock files at 0 (minimum clamp)', () => {
        expect(heuristicRisk({ filename: 'package-lock.json', additions: 0, deletions: 0 })).toBe(0)
        expect(heuristicRisk({ filename: 'yarn.lock', additions: 0, deletions: 0 })).toBe(0)
    })

    it('scores vendor/generated/min files at 0', () => {
        expect(heuristicRisk({ filename: 'vendor/react.js', additions: 10, deletions: 0 })).toBe(0)
        expect(heuristicRisk({ filename: 'dist/bundle.min.js', additions: 1000, deletions: 0 })).toBe(0)
        expect(heuristicRisk({ filename: 'src/api.generated.ts', additions: 50, deletions: 0 })).toBe(0)
    })

    it('large changes score higher than small changes for the same file', () => {
        const small = heuristicRisk({ filename: 'src/utils/helper.js', additions: 10, deletions: 5 })
        const medium = heuristicRisk({ filename: 'src/utils/helper.js', additions: 150, deletions: 60 })
        const large = heuristicRisk({ filename: 'src/utils/helper.js', additions: 300, deletions: 250 })
        expect(medium).toBeGreaterThan(small)
        expect(large).toBeGreaterThan(medium)
    })

    it('clamps score to a minimum of 0', () => {
        // eslintrc file gets -1, starting at 0, so should be clamped to 0
        const score = heuristicRisk({ filename: '.eslintrc.js', additions: 1, deletions: 1 })
        expect(score).toBe(0)
    })

    it('clamps score to a maximum of 5', () => {
        // auth + migration + very large = 3+2+2+1 = 8, clamped to 5
        const score = heuristicRisk({
            filename: 'server/auth/migrations/schema.sql',
            additions: 600,
            deletions: 100,
        })
        expect(score).toBe(5)
    })

    it('returns 0 for a normal small file', () => {
        expect(heuristicRisk({ filename: 'src/components/Button.jsx', additions: 5, deletions: 2 })).toBe(0)
    })

    it('scores migration/schema files higher', () => {
        expect(heuristicRisk({ filename: 'db/migrations/001_init.js', additions: 10, deletions: 0 })).toBeGreaterThanOrEqual(2)
        expect(heuristicRisk({ filename: 'database/schema.sql', additions: 10, deletions: 0 })).toBeGreaterThanOrEqual(2)
    })

    it('additions + deletions > 200 adds 2 points', () => {
        const baseline = heuristicRisk({ filename: 'src/foo.js', additions: 10, deletions: 0 })
        const over200 = heuristicRisk({ filename: 'src/foo.js', additions: 150, deletions: 60 })
        expect(over200 - baseline).toBe(2)
    })

    it('additions + deletions > 500 adds an extra point on top of the >200 bonus', () => {
        const over200 = heuristicRisk({ filename: 'src/foo.js', additions: 150, deletions: 60 })
        const over500 = heuristicRisk({ filename: 'src/foo.js', additions: 400, deletions: 150 })
        expect(over500 - over200).toBe(1)
    })
})
