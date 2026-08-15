/*
 * The server deploy has to be able to undo itself.
 *
 * Before deploy.ps1 the documented upgrade was `git checkout; npm ci; npm run
 * build` on the production box: a clone, a toolchain and a network build,
 * with no backup, no verification and no way back. The platform next door has
 * had a verified-backup-and-rollback script for months; this is the same
 * contract for a service rather than a static site.
 *
 * These assert the guarantees exist in the script and that the guide teaches
 * them. Whether PowerShell parses is checked by CI on Windows, not here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const NEWLINE = String.fromCharCode(10)

const SCRIPT = 'deploy/iis/deploy.ps1'
const GUIDE = 'docs/guides/deploy-iis-windows.md'

describe('the IIS deploy script', () => {
    it('exists where the guide sends people', () => {
        expect(existsSync(SCRIPT)).toBe(true)
        expect(readFileSync(GUIDE, 'utf8')).toContain('deploy.ps1')
    })

    const src = existsSync(SCRIPT) ? readFileSync(SCRIPT, 'utf8') : ''

    it('takes a backup before it stops anything', () => {
        const backup = src.indexOf("Write-Section '3. Backup'")
        const stop = src.indexOf("Write-Section '4. Stopping the service'")
        expect(backup).toBeGreaterThan(-1)
        expect(stop).toBeGreaterThan(backup)
    })

    it('refuses a backup it could not complete', () => {
        // A partial backup is worse than none: it looks like a way back.
        expect(src).toContain('Backup incomplete')
        expect(src).toMatch(/refusing to continue without a way back/i)
    })

    it('checks the version it deployed, not merely that something answers', () => {
        // The dangerous "success" is the OLD build still running: healthy, and
        // not what you deployed.
        expect(src).toContain('ExpectVersion')
        expect(src).toMatch(/expected \$ExpectVersion/)
        expect(src).toContain('/api/health/ready')
    })

    it('rolls back on its own when verification fails', () => {
        const verify = src.indexOf("Write-Section '7. Verifying'")
        const rollback = src.indexOf("Write-Section '8. Rolling back'")
        expect(verify).toBeGreaterThan(-1)
        expect(rollback).toBeGreaterThan(verify)
        expect(src).toMatch(/Deploy of v\$\(\$pkg\.Version\) failed and was reverted/)
    })

    it('refuses an artifact whose file name disagrees with its manifest', () => {
        expect(src).toMatch(/refusing a mislabelled artifact/i)
    })

    it('verifies the download against the published checksum', () => {
        expect(src).toContain('Get-FileHash')
        expect(src).toMatch(/Checksum mismatch/)
    })

    it('never rebuilds on the server', () => {
        // The whole point of the immutable artifact. Checked against executable
        // lines only — the header explains WHY it does not run npm, and that
        // explanation is not an invocation.
        const executable = src.split(NEWLINE)
            .filter((l) => !l.trimStart().startsWith('#') && !l.trimStart().startsWith('.'))
            .join(NEWLINE)
        expect(executable).not.toMatch(new RegExp(String.raw`(^|[;&|\s])npm\s+(ci|install|run)\b`, 'm'))
    })

    it('leaves DATA_DIR alone, and says so', () => {
        expect(src).toMatch(/DATA_DIR/)
        expect(src).toMatch(/never touched/i)
    })

    it('only requires elevation once it is about to change something', () => {
        // -DryRun and -ListBackups read; making them need an admin shell would
        // stop people checking before they commit.
        const dryRunExit = src.indexOf('Elevation is only required from step 3 onwards')
        const assertAdmin = src.lastIndexOf('Assert-Admin')
        expect(dryRunExit).toBeGreaterThan(-1)
        expect(assertAdmin).toBeGreaterThan(dryRunExit)
    })
})

describe('the workflow that used to pretend to deploy', () => {
    it('is gone, not merely disabled', () => {
        // Its only surviving job was a pre-deploy gate for two deploy jobs
        // that no longer exist, behind a variable nobody ever set. ci.yml is
        // what actually runs on every push.
        expect(existsSync('.github/workflows/deploy.yml')).toBe(false)
        expect(existsSync('.github/workflows/ci.yml')).toBe(true)
    })

    it('leaves no badge or doc pointing at it', () => {
        for (const doc of ['README.md', 'docs/operations.md', '.github/dependabot.yml']) {
            expect(readFileSync(doc, 'utf8'), doc).not.toContain('deploy.yml')
        }
    })
})

describe('HSTS asks only for what can be honoured', () => {
    it('does not send preload from a subdomain', () => {
        // The preload list only accepts apex domains; the apex here sends a
        // bare max-age. A directive nothing can act on is noise.
        const server = readFileSync('server/index.js', 'utf8')
        const hsts = server.slice(server.indexOf('hsts:'), server.indexOf('hsts:') + 200)
        expect(hsts).not.toContain('preload')
        expect(hsts).toContain('includeSubDomains')
    })
})
