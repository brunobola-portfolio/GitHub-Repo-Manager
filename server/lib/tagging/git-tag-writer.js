// Annotated git tag writer. Uses simple-git to create the tag (force-mode for
// idempotency) and pushes to provided remotes. Per-remote push failures are
// captured in the payload but do not throw — the local tag still succeeded.
import simpleGit from 'simple-git'
import { STATUS } from '../migration-tagging-constants.js'

export function createGitTagWriter() {
  async function createAnnotatedTag({ repoDir, tagName, message, remotes = [] }) {
    const git = simpleGit(repoDir)
    await git.raw(['tag', '-a', '-f', tagName, '-m', message])

    const pushed = []
    for (const remote of remotes) {
      try {
        await git.push(remote.name, tagName, ['--force-with-lease'])
        pushed.push({ name: remote.name, status: 'ok' })
      } catch (err) {
        pushed.push({ name: remote.name, error: err?.message || String(err) })
      }
    }
    return { status: STATUS.WRITTEN, payload: { tagName, pushed } }
  }

  return { createAnnotatedTag }
}
