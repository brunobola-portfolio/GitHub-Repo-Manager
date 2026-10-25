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
        expect(guard).toBeLessThan(releaseJob.indexOf('npm ci'))
        expect(guard).toBeLessThan(releaseJob.indexOf('npm run build'))
    })

    it('the deploy and windows jobs depend on the release job', () => {
        expect(wf).toMatch(/\n {2}windows:[\s\S]*?needs: release/)
        expect(wf).toMatch(/\n {2}deploy:\n {4}needs: \[release, windows\]/)
    })
})
