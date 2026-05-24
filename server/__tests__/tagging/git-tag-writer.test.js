import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import simpleGit from 'simple-git'
import { createGitTagWriter } from '../../lib/tagging/git-tag-writer.js'

describe('gitTagWriter.createAnnotatedTag', () => {
  let dir

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mig-tag-'))
    const git = simpleGit(dir)
    await git.init()
    await git.addConfig('user.email', 'test@test.com')
    await git.addConfig('user.name', 'Test User')
    writeFileSync(join(dir, 'README.md'), '# test\n')
    await git.add('README.md')
    await git.commit('initial')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates an annotated tag at HEAD with the JSON message', async () => {
    const writer = createGitTagWriter()
    const res = await writer.createAnnotatedTag({
      repoDir: dir,
      tagName: 'migration/2026-05-23-42',
      message: JSON.stringify({ planId: 42 }),
      remotes: []
    })
    expect(res.status).toBe('written')
    expect(res.payload.tagName).toBe('migration/2026-05-23-42')

    const git = simpleGit(dir)
    const tags = await git.tags()
    expect(tags.all).toContain('migration/2026-05-23-42')

    const show = await git.raw(['for-each-ref', 'refs/tags/migration/2026-05-23-42', '--format=%(contents)'])
    expect(show.trim()).toContain('"planId":42')
  })

  it('re-runs without error using force on existing tag', async () => {
    const writer = createGitTagWriter()
    await writer.createAnnotatedTag({
      repoDir: dir,
      tagName: 'migration/2026-05-23-42',
      message: 'v1',
      remotes: []
    })
    const res = await writer.createAnnotatedTag({
      repoDir: dir,
      tagName: 'migration/2026-05-23-42',
      message: 'v2',
      remotes: []
    })
    expect(res.status).toBe('written')

    const git = simpleGit(dir)
    const show = await git.raw(['for-each-ref', 'refs/tags/migration/2026-05-23-42', '--format=%(contents)'])
    expect(show.trim()).toContain('v2')
  })

  it('records remote push errors in payload without throwing', async () => {
    const writer = createGitTagWriter()
    const res = await writer.createAnnotatedTag({
      repoDir: dir,
      tagName: 'migration/bad-remote',
      message: 'm',
      remotes: [{ name: 'doesnotexist' }]
    })
    expect(res.status).toBe('written')
    const pushed = res.payload.pushed
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toMatchObject({ name: 'doesnotexist' })
    expect(pushed[0].error).toBeDefined()
  })
})
