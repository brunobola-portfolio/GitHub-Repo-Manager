// Azure DevOps source writer. Handles project-level properties (JSON-Patch)
// and per-repo description updates. Knows nothing about plans or persistence.
import { DESCRIPTION_SUFFIX_REGEX, STATUS, SKIP_REASONS } from '../migration-tagging-constants.js'

const API_VERSION = '7.1-preview.1'

export function createAzureWriter({ api, host, org, pat }) {
  const baseUrl = `https://${host}/${encodeURIComponent(org)}`
  const auth = Buffer.from(`:${pat}`).toString('base64')
  const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' }

  function classifyErr(err) {
    const code = err?.response?.status
    if (code === 401 || code === 403) return SKIP_REASONS.PAT_SCOPE_MISSING
    if (code === 404) return SKIP_REASONS.UNSUPPORTED_SOURCE_TYPE
    return null
  }

  async function patchProjectProperties(projectId, ops) {
    try {
      await api.patch(
        `${baseUrl}/_apis/projects/${encodeURIComponent(projectId)}/properties?api-version=${API_VERSION}`,
        ops,
        { headers: { ...headers, 'Content-Type': 'application/json-patch+json' } }
      )
      return { status: STATUS.WRITTEN, payload: { ops } }
    } catch (err) {
      const reason = classifyErr(err)
      if (reason) return { status: STATUS.SKIPPED, skipReason: reason, payload: { ops } }
      throw err
    }
  }

  async function appendRepoDescription({ projectId, repoId }, suffix) {
    try {
      const { data } = await api.get(
        `${baseUrl}/${encodeURIComponent(projectId)}/_apis/git/repositories/${encodeURIComponent(repoId)}?api-version=${API_VERSION}`,
        { headers }
      )
      const current = data?.description || ''
      const stripped = current.replace(DESCRIPTION_SUFFIX_REGEX, '')
      const next = `${stripped}${suffix}`.trim()
      await api.patch(
        `${baseUrl}/${encodeURIComponent(projectId)}/_apis/git/repositories/${encodeURIComponent(repoId)}?api-version=${API_VERSION}`,
        { description: next },
        { headers: { ...headers, 'Content-Type': 'application/json' } }
      )
      return { status: STATUS.WRITTEN, payload: { description: next } }
    } catch (err) {
      const reason = classifyErr(err)
      if (reason) return { status: STATUS.SKIPPED, skipReason: reason, payload: { suffix } }
      throw err
    }
  }

  return { patchProjectProperties, appendRepoDescription }
}
