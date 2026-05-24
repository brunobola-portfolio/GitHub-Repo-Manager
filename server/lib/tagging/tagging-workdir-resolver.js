// Resolves a transient git workdir for the tagging service to attach an
// annotated tag to. The import-service deletes its own workdir in `finally`
// before plan-complete fires, so we shallow-clone the destination on demand,
// let the git-tag-writer add + push the tag, then cleanup.
//
// Returns either:
//   - null              → cannot resolve (no token, no repoUrl, fetch failed)
//   - { repoDir, cleanup, remotes }  → success
//
// The service is responsible for calling `cleanup()` after the writer runs.
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import simpleGit from 'simple-git'

const FETCH_TIMEOUT_MS = 120_000  // 2 min cap on clone

export function createTaggingWorkdirResolver({ credentials, logger = { warn() {} } }) {
  return async function resolveWorkdir({ task, meta = {} }) {
    const token = credentials?.github
    const repoUrl = meta?.repoUrl
    const defaultBranch = meta?.defaultBranch || 'HEAD'

    if (!token || !repoUrl) return null

    let dir = null
    try {
      dir = mkdtempSync(join(tmpdir(), 'mig-tag-'))
      // Inject token into the URL so simple-git uses it without prompting.
      // x-access-token is the conventional username for GitHub PAT/OAuth.
      const authedUrl = repoUrl.replace(/^https:\/\//, `https://x-access-token:${encodeURIComponent(token)}@`)

      const git = simpleGit({ timeout: { block: FETCH_TIMEOUT_MS } }).cwd(dir)
      await git.init()
      await git.addRemote('origin', authedUrl)
      await git.fetch('origin', defaultBranch, ['--depth', '1'])
      await git.raw(['checkout', 'FETCH_HEAD'])

      return {
        repoDir: dir,
        remotes: [{ name: 'origin' }],
        cleanup: () => {
          try { rmSync(dir, { recursive: true, force: true }) }
          catch (err) { logger.warn?.({ err, dir }, 'tagging-workdir cleanup failed') }
        }
      }
    } catch (err) {
      logger.warn?.({ err, repoUrl, taskId: task?.id }, 'tagging-workdir clone failed; git-tag mark will be skipped')
      if (dir) {
        try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
      }
      return null
    }
  }
}
