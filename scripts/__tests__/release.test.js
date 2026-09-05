import { describe, it, expect } from 'vitest'
import {
    bumpVersion,
    changelogAnchor,
    promoteUnreleased,
    setPackageVersion,
    updateWhatsNew,
} from '../lib/release-lib.mjs'

const REPO = 'https://github.com/o/r'

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed

- Something.

## [4.23.2] - 2026-08-31

### Fixed

- Older.

[Unreleased]: ${REPO}/compare/v4.23.0...HEAD
[4.23.2]: ${REPO}/compare/v4.23.1...v4.23.2
`

describe('bumpVersion', () => {
    it('bumps each component and accepts an explicit version', () => {
        expect(bumpVersion('4.23.2', 'patch')).toBe('4.23.3')
        expect(bumpVersion('4.23.2', 'minor')).toBe('4.24.0')
        expect(bumpVersion('4.23.2', 'major')).toBe('5.0.0')
        expect(bumpVersion('4.23.2', '6.1.0')).toBe('6.1.0')
        expect(() => bumpVersion('4.23.2', 'huge')).toThrow(/Unknown bump/)
    })
})

describe('promoteUnreleased', () => {
    it('inserts the dated heading under Unreleased and rewrites both compare links', () => {
        const out = promoteUnreleased(CHANGELOG, { version: '4.24.0', previous: '4.23.2', date: '2026-09-06', repoUrl: REPO })
        expect(out).toContain('## [Unreleased]\n\n## [4.24.0] - 2026-09-06\n\n### Fixed\n\n- Something.')
        expect(out).toContain(`[Unreleased]: ${REPO}/compare/v4.24.0...HEAD\n[4.24.0]: ${REPO}/compare/v4.23.2...v4.24.0\n[4.23.2]:`)
    })

    it('refuses an empty Unreleased section', () => {
        const empty = CHANGELOG.replace('### Fixed\n\n- Something.\n', '')
        expect(() => promoteUnreleased(empty, { version: '4.24.0', previous: '4.23.2', date: '2026-09-06', repoUrl: REPO })).toThrow(/empty/)
    })

    it('refuses a version that already has a section', () => {
        expect(() => promoteUnreleased(CHANGELOG, { version: '4.23.2', previous: '4.23.1', date: '2026-09-06', repoUrl: REPO })).toThrow(/already/)
    })
})

describe('setPackageVersion', () => {
    it('rewrites only the version field and keeps the formatting', () => {
        const pkg = '{\n  "name": "x",\n  "version": "4.23.2",\n  "dependencies": { "a": "1.0.0" }\n}\n'
        expect(setPackageVersion(pkg, '4.24.0')).toBe(pkg.replace('4.23.2', '4.24.0'))
    })

    it('updates the lockfile root entry as well', () => {
        const lock = '{\n  "name": "x",\n  "version": "4.23.2",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "x",\n      "version": "4.23.2",\n      "dependencies": {}\n    },\n    "node_modules/a": { "version": "1.0.0" }\n  }\n}\n'
        const out = setPackageVersion(lock, '4.24.0', { lockfile: true })
        expect(out.match(/4\.24\.0/g)).toHaveLength(2)
        expect(out).toContain('"node_modules/a": { "version": "1.0.0" }')
    })
})

describe('updateWhatsNew', () => {
    it('points the README link at the new changelog anchor', () => {
        const readme = "[Docs](docs/index.md) · [What's new in v4.20 — the launch blockers, closed](CHANGELOG.md#4200---2026-08-17)\n"
        const out = updateWhatsNew(readme, { version: '4.24.0', date: '2026-09-06', title: 'the polish release' })
        expect(out).toBe("[Docs](docs/index.md) · [What's new in v4.24 — the polish release](CHANGELOG.md#4240---2026-09-06)\n")
        expect(changelogAnchor('4.24.0', '2026-09-06')).toBe('4240---2026-09-06')
    })
})
