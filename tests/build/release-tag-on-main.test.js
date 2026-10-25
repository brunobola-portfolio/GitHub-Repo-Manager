/*
 * release.yml runs only on a v* tag and its deploy job installs on the
 * production server, so a mistake here surfaces after publishing. This gate
 * pins the guard that refuses a tag whose commit is not on main, and that it
 * runs before anything is built, in the job every other job needs.
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const wf = readFileSync('.github/workflows/release.yml', 'utf8')
const releaseJob = wf.slice(wf.indexOf('\n  release:'), wf.indexOf('\n  windows:'))

describe('release.yml only ships commits that are on main', () => {
    it('the release job checks the tagged commit is an ancestor of origin/main', () => {
        expect(releaseJob).toMatch(/git fetch --no-tags origin main/)
        expect(releaseJob).toMatch(/git merge-base --is-ancestor HEAD origin\/main/)
        expect(releaseJob).toMatch(/exit 1/)
    })

    it('the check runs before install and build', () => {
        const guard = releaseJob.indexOf('merge-base --is-ancestor')
        expect(guard).toBeGreaterThan(-1)
        expect(guard).toBeLessThan(releaseJob.indexOf('- run: npm ci'))
        expect(guard).toBeLessThan(releaseJob.indexOf('run: npm run build'))
    })

    it('later jobs use the commit and tag the gate verified, never a fresh resolution of the tag', () => {
        expect(releaseJob).toMatch(/outputs:\n\s+sha: \$\{\{ steps\.onmain\.outputs\.sha \}\}/)
        expect(releaseJob).toMatch(/echo "sha=\$\(git rev-parse HEAD\)" >> "\$GITHUB_OUTPUT"/)
        const windowsJob = wf.slice(wf.indexOf('\n  windows:'), wf.indexOf('\n  deploy:'))
        const deployJob = wf.slice(wf.indexOf('\n  deploy:'))
        expect(windowsJob).toMatch(/ref: \$\{\{ needs\.release\.outputs\.sha \}\}/)
        expect(windowsJob).not.toMatch(/github\.ref_name|inputs\.tag/)
        expect(deployJob).toMatch(/-FromRelease \$env:RELEASE_TAG/)
        expect(deployJob).not.toMatch(/GITHUB_REF_NAME/)
    })

    it('the deploy and windows jobs depend on the release job', () => {
        expect(wf).toMatch(/\n {2}windows:[\s\S]*?needs: release/)
        expect(wf).toMatch(/\n {2}deploy:\n {4}needs: \[release, windows\]/)
    })
})
