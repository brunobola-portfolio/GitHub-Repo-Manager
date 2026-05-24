import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import simpleGit from 'simple-git'
import { createTaggingWorkdirResolver } from '../../lib/tagging/tagging-workdir-resolver.js'

// Local bare repo serves as the "remote destination" the resolver clones from.
// This avoids any network access while still exercising the real simple-git
// fetch/checkout flow.
async function makeSeedAndBareRemote() {
  const seedDir = mkdtempSync(join(tmpdir(), 'mig-seed-'))
  const seedGit = simpleGit(seedDir)
  await seedGit.init()
  await seedGit.checkoutLocalBranch('main')
  await seedGit.addConfig('user.email', 'test@test.com')
  await seedGit.addConfig('user.name', 'Test User')
  writeFileSync(join(seedDir, 'README.md'), '# seed\n')
  await seedGit.add('README.md')
  await seedGit.commit('initial')

  const bareDir = mkdtempSync(join(tmpdir(), 'mig-bare-'))
  await simpleGit().raw(['init', '--bare', bareDir])
  await seedGit.addRemote('origin', bareDir)
  await seedGit.push('origin', 'main')

  return { seedDir, bareDir }
}

describe('createTaggingWorkdirResolver', () => {
  let seedDir, bareDir, resolvedDirs

  beforeEach(async () => {
    const r = await makeSeedAndBareRemote()
    seedDir = r.seedDir
    bareDir = r.bareDir
    resolvedDirs = []
  })

  afterEach(() => {
    rmSync(seedDir, { recursive: true, force: true })
    rmSync(bareDir, { recursive: true, force: true })
    for (const d of resolvedDirs) {
      try { rmSync(d, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
  })

  it('returns null when no GitHub token in credentials', async () => {
    const resolve = createTaggingWorkdirResolver({ credentials: {} })
    const out = await resolve({ task: { id: 1 }, meta: { repoUrl: bareDir } })
    expect(out).toBe(null)
  })

  it('returns null when meta.repoUrl is missing', async () => {
    const resolve = createTaggingWorkdirResolver({ credentials: { github: 'x' } })
    const out = await resolve({ task: { id: 1 }, meta: {} })
    expect(out).toBe(null)
  })

  it('clones the destination, exposes repoDir/remotes/cleanup, and cleanup removes the dir', async () => {
    // The resolver injects auth into https:// URLs; for a local file path it
    // falls through unchanged, which is what we want for this test.
    const resolve = createTaggingWorkdirResolver({ credentials: { github: 'token' } })
    const out = await resolve({ task: { id: 1 }, meta: { repoUrl: bareDir, defaultBranch: 'main' } })
    expect(out).not.toBe(null)
    expect(out.repoDir).toBeDefined()
    expect(out.remotes).toEqual([{ name: 'origin' }])
    expect(typeof out.cleanup).toBe('function')
    resolvedDirs.push(out.repoDir)

    expect(existsSync(out.repoDir)).toBe(true)
    expect(readdirSync(out.repoDir)).toContain('README.md')

    out.cleanup()
    expect(existsSync(out.repoDir)).toBe(false)
  })

  it('returns null and cleans up partial dir when fetch fails', async () => {
    const resolve = createTaggingWorkdirResolver({ credentials: { github: 'token' } })
    const out = await resolve({ task: { id: 1 }, meta: { repoUrl: '/does/not/exist', defaultBranch: 'main' } })
    expect(out).toBe(null)
  })
})
