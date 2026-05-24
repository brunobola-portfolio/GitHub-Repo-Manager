// GitHub destination writer. Handles topics, description, and Custom Properties.
// All API calls go through the injected `api` (axios-compatible) so tests can
// mock cleanly. Knows nothing about plans, marks, or persistence.
import { GITHUB_MAX_TOPICS, DESCRIPTION_SUFFIX_REGEX, STATUS, SKIP_REASONS } from '../migration-tagging-constants.js'

export function createGithubWriter({ api, token }) {
  const authHeaders = {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json'
    }
  }

  async function setTopics({ owner, repo }, desiredTopics) {
    const { data } = await api.get(`/repos/${owner}/${repo}/topics`, authHeaders)
    const existing = Array.isArray(data?.names) ? data.names : []
    const required = desiredTopics.slice(0, 2)
    const optional = desiredTopics.slice(2)
    const merged = Array.from(new Set([...existing, ...required]))
    const skippedTopics = []
    for (const topic of optional) {
      if (merged.length >= GITHUB_MAX_TOPICS) {
        skippedTopics.push(topic)
        continue
      }
      if (!merged.includes(topic)) merged.push(topic)
    }
    const finalNames = merged.slice(0, GITHUB_MAX_TOPICS)
    await api.put(`/repos/${owner}/${repo}/topics`, { names: finalNames }, authHeaders)
    return {
      status: STATUS.WRITTEN,
      payload: { topics: finalNames, skippedTopics },
      skippedTopics,
      skipReason: skippedTopics.length ? SKIP_REASONS.TOPIC_LIMIT_REACHED : null
    }
  }

  async function appendDescription({ owner, repo }, suffix) {
    const { data } = await api.get(`/repos/${owner}/${repo}`, authHeaders)
    const current = data?.description || ''
    const stripped = current.replace(DESCRIPTION_SUFFIX_REGEX, '')
    const next = `${stripped}${suffix}`.trim()
    await api.patch(`/repos/${owner}/${repo}`, { description: next }, authHeaders)
    return { status: STATUS.WRITTEN, payload: { description: next } }
  }

  async function setCustomProperty({ owner, repo }, name, value, { isPersonal = false } = {}) {
    try {
      await api.patch(
        `/repos/${owner}/${repo}/properties/values`,
        { properties: [{ property_name: name, value: String(value) }] },
        authHeaders
      )
      return { status: STATUS.WRITTEN, payload: { name, value } }
    } catch (err) {
      const code = err?.response?.status
      if (code === 404) {
        return {
          status: STATUS.SKIPPED,
          skipReason: isPersonal
            ? SKIP_REASONS.PERSONAL_ACCOUNT_NO_PROPS
            : SKIP_REASONS.ORG_POLICY_BLOCKS_CUSTOM_PROPS,
          payload: { name, value }
        }
      }
      throw err
    }
  }

  return { setTopics, appendDescription, setCustomProperty }
}
