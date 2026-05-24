/**
 * Work Item Service
 * Migrates Azure DevOps Work Items to GitHub Issues.
 *
 * SSRF protection: attachment URLs validated against *.dev.azure.com and *.visualstudio.com
 * Rate limiting: tracks X-RateLimit-Remaining header, pauses when < 100
 */

import { fetchWorkItems } from './azure-service.js'
import { basicAuthHeader } from './lib/basic-auth-header.js'

/**
 * Escapes single quotes in a WIQL value to prevent injection.
 * @param {string} value
 * @returns {string}
 */
function escapeWiql(value) {
  return value.replace(/'/g, "''")
}

const ALLOWED_ATTACHMENT_HOSTS = [
  /^[a-z0-9-]+\.dev\.azure\.com$/i,
  /^[a-z0-9-]+\.visualstudio\.com$/i
]

/**
 * Validates a URL against allowed Azure DevOps domains (SSRF protection).
 * @param {string} url
 * @returns {boolean}
 */
function isAllowedAttachmentUrl(url) {
  try {
    const parsed = new URL(url)
    return ALLOWED_ATTACHMENT_HOSTS.some(pattern => pattern.test(parsed.hostname))
  } catch {
    return false
  }
}

/**
 * Converts simple HTML to Markdown.
 * Handles: <br>, <p>, <strong>, <b>, <em>, <i>, <code>, <a>, strips remaining tags.
 * @param {string|null} html
 * @returns {string}
 */
function htmlToMarkdown(html) {
  if (!html) return ''

  let md = html

  // <br> and <br/> → newline
  md = md.replace(/<br\s*\/?>/gi, '\n')

  // <p>...</p> → double newline wrapping
  md = md.replace(/<\/p>/gi, '\n\n')
  md = md.replace(/<p[^>]*>/gi, '')

  // <strong> / <b> → **bold**
  md = md.replace(/<(strong|b)>(.*?)<\/\1>/gi, '**$2**')

  // <em> / <i> → *italic*
  md = md.replace(/<(em|i)>(.*?)<\/\1>/gi, '*$2*')

  // <code> → `code`
  md = md.replace(/<code>(.*?)<\/code>/gi, '`$1`')

  // <a href="url">text</a> → [text](url) with protocol validation
  md = md.replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (match, href, text) => {
    const safeHref = /^(https?:|mailto:)/i.test(href) ? href : '#'
    return `[${text}](${safeHref})`
  })

  // Strip any remaining HTML tags
  md = md.replace(/<[^>]+>/g, '')

  // Trim trailing whitespace
  md = md.trim()

  return md
}

/**
 * Generates label array for a GitHub Issue from work item metadata.
 * @param {string} type - Work item type (e.g., 'Bug', 'User Story')
 * @param {string} state - Work item state (e.g., 'Active', 'New')
 * @param {number|null} priority - Priority 1-4 or null
 * @param {object} labelMapping - Map of ADO type → GitHub label (e.g., { Bug: 'bug' })
 * @returns {string[]}
 */
function buildLabels(type, state, priority, labelMapping) {
  const labels = []

  // Type label from mapping
  if (labelMapping && labelMapping[type]) {
    labels.push(labelMapping[type])
  }

  // State label (lowercase)
  if (state) {
    labels.push(state.toLowerCase())
  }

  // Priority label
  if (priority != null) {
    labels.push(`priority:${priority}`)
  }

  return labels
}

/**
 * Builds the GitHub Issue body from an ADO work item.
 * Includes metadata table and converted description.
 * @param {object} item - Work item with id, title, type, state, description, assignedTo, areaPath, iteration, createdDate
 * @param {object} [hierarchyLinks] - Optional { parentIssue: number, childIssues: number[] }
 * @returns {string}
 */
function buildIssueBody(item, hierarchyLinks) {
  const lines = []

  // Description (HTML → Markdown)
  const description = htmlToMarkdown(item.description)
  if (description) {
    lines.push(description)
    lines.push('')
  }

  // Metadata table
  lines.push('## Metadata')
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('|-------|-------|')
  lines.push(`| **Source** | Azure DevOps |`)
  lines.push(`| **Original ID** | ${item.id} |`)
  lines.push(`| **Type** | ${item.type || ''} |`)
  lines.push(`| **State** | ${item.state || ''} |`)

  if (item.assignedTo) {
    lines.push(`| **Assigned To** | ${item.assignedTo} |`)
  }
  if (item.areaPath) {
    lines.push(`| **Area Path** | ${item.areaPath} |`)
  }
  if (item.iteration) {
    lines.push(`| **Iteration** | ${item.iteration} |`)
  }
  if (item.createdDate) {
    lines.push(`| **Created** | ${item.createdDate} |`)
  }

  // Hierarchy links
  if (hierarchyLinks) {
    lines.push('')
    lines.push('## Hierarchy')
    lines.push('')
    if (hierarchyLinks.parentIssue) {
      lines.push(`Parent: #${hierarchyLinks.parentIssue}`)
    }
    if (hierarchyLinks.childIssues && hierarchyLinks.childIssues.length > 0) {
      lines.push(`Children: ${hierarchyLinks.childIssues.map(n => `#${n}`).join(', ')}`)
    }
  }

  return lines.join('\n')
}

/**
 * Topological sort of work items by parent/child hierarchy.
 * Parents appear before children in the output.
 * Handles circular references gracefully by appending remaining items.
 * @param {Array<{ id: number, relations: Array<{ rel: string, url: string }> }>} items
 * @returns {Array} items ordered parents-first
 */
function buildDependencyTree(items) {
  if (!items || items.length === 0) return []

  // Build a map of item ID → item
  const itemMap = new Map()
  for (const item of items) {
    itemMap.set(item.id, item)
  }

  // Build parent map: childId → parentId
  const parentMap = new Map()
  for (const item of items) {
    if (!item.relations) continue
    for (const rel of item.relations) {
      if (rel.rel === 'System.LinkTypes.Hierarchy-Reverse') {
        // Extract parent ID from URL (e.g., '/workItems/123' or full URL)
        const match = rel.url.match(/\/workItems\/(\d+)/)
        if (match) {
          parentMap.set(item.id, parseInt(match[1], 10))
        }
      }
    }
  }

  // Topological sort using Kahn's algorithm
  // Build children map for in-degree tracking
  const childrenMap = new Map() // parentId → [childId, ...]
  const inDegree = new Map()

  for (const item of items) {
    inDegree.set(item.id, 0)
    if (!childrenMap.has(item.id)) {
      childrenMap.set(item.id, [])
    }
  }

  for (const [childId, parentId] of parentMap) {
    // Only count if the parent is in our item set
    if (itemMap.has(parentId)) {
      inDegree.set(childId, (inDegree.get(childId) || 0) + 1)
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, [])
      }
      childrenMap.get(parentId).push(childId)
    }
  }

  // Start with items that have no parent (in-degree 0)
  const queue = []
  for (const item of items) {
    if (inDegree.get(item.id) === 0) {
      queue.push(item)
    }
  }

  const ordered = []
  const visited = new Set()

  while (queue.length > 0) {
    const item = queue.shift()
    if (visited.has(item.id)) continue
    visited.add(item.id)
    ordered.push(item)

    const children = childrenMap.get(item.id) || []
    for (const childId of children) {
      inDegree.set(childId, (inDegree.get(childId) || 0) - 1)
      if (inDegree.get(childId) <= 0 && !visited.has(childId) && itemMap.has(childId)) {
        queue.push(itemMap.get(childId))
      }
    }
  }

  // Handle circular references: append any items not yet visited
  for (const item of items) {
    if (!visited.has(item.id)) {
      ordered.push(item)
    }
  }

  return ordered
}

/**
 * Ensures a label exists on the target GitHub repo. Creates it if missing.
 * @param {string} label
 * @param {string} githubToken
 * @param {string} owner
 * @param {string} repo
 * @param {Set<string>} existingLabels - Mutable set of known labels (updated on create)
 * @returns {Promise<boolean>} true if label was created, false if it already existed
 */
async function ensureLabel(label, githubToken, owner, repo, existingLabels) {
  if (existingLabels.has(label)) return false

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: label,
        color: generateLabelColor(label)
      })
    })

    if (res.ok || res.status === 422) {
      // 422 means label already exists
      existingLabels.add(label)
      return res.ok
    }

    return false
  } catch {
    return false
  }
}

/**
 * Generates a deterministic hex color for a label name.
 * @param {string} name
 * @returns {string} 6-char hex color (no #)
 */
function generateLabelColor(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  const color = Math.abs(hash).toString(16).padStart(6, '0').slice(0, 6)
  return color
}

/**
 * Creates a GitHub Issue via the REST API with rate limit awareness.
 * Pauses when X-RateLimit-Remaining drops below 100.
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.body
 * @param {string[]} params.labels
 * @param {string} params.githubToken
 * @param {string} params.owner
 * @param {string} params.repo
 * @returns {Promise<{ number: number, url: string }>}
 */
async function createGitHubIssue({ title, body, labels, githubToken, owner, repo }) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title, body, labels })
  })

  // Rate limit handling
  const remaining = parseInt(res.headers.get('X-RateLimit-Remaining'), 10)
  if (!isNaN(remaining) && remaining < 100) {
    const resetTime = parseInt(res.headers.get('X-RateLimit-Reset'), 10)
    const waitMs = Math.max(0, (resetTime * 1000) - Date.now()) + 1000
    // Cap the wait to 60 seconds to avoid hanging indefinitely
    const cappedWait = Math.min(waitMs, 60000)
    await new Promise(resolve => setTimeout(resolve, cappedWait))
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => null)
    const message = errBody?.message || `GitHub API error: ${res.status} ${res.statusText}`
    const error = new Error(message)
    error.status = res.status
    throw error
  }

  const data = await res.json()
  return { number: data.number, url: data.html_url }
}

/**
 * Normalizes a raw ADO work item (from the API) into a flat object for processing.
 * @param {object} raw - Raw work item from Azure DevOps API
 * @returns {object} Normalized work item
 */
function normalizeWorkItem(raw) {
  const fields = raw.fields || {}
  return {
    id: raw.id,
    title: fields['System.Title'] || '',
    type: fields['System.WorkItemType'] || '',
    state: fields['System.State'] || '',
    description: fields['System.Description'] || '',
    assignedTo: fields['System.AssignedTo']?.displayName || '',
    areaPath: fields['System.AreaPath'] || '',
    iteration: fields['System.IterationPath'] || '',
    createdDate: fields['System.CreatedDate'] || '',
    priority: fields['Microsoft.VSTS.Common.Priority'] || null,
    relations: raw.relations || []
  }
}

/**
 * Fetches existing labels from a GitHub repository.
 * @param {string} githubToken
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<Set<string>>}
 */
async function fetchExistingLabels(githubToken, owner, repo) {
  const labels = new Set()
  let page = 1

  while (true) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/labels?per_page=100&page=${page}`,
      {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    )

    if (!res.ok) break

    const data = await res.json()
    if (data.length === 0) break

    for (const label of data) {
      labels.add(label.name)
    }

    page++
  }

  return labels
}

/**
 * Main entry point: migrates Azure DevOps work items to GitHub Issues.
 *
 * @param {object} config - Migration configuration
 * @param {string} config.org - Azure DevOps organization
 * @param {string} config.project - Azure DevOps project
 * @param {string[]} [config.types] - Work item types to migrate (e.g., ['Bug', 'User Story'])
 * @param {object} [config.labelMapping] - Map of ADO type → GitHub label
 * @param {object} azureCreds - Azure DevOps credentials
 * @param {string} azureCreds.pat - Personal Access Token
 * @param {string} githubToken - GitHub personal access token
 * @param {string} targetOwner - GitHub repo owner
 * @param {string} targetRepo - GitHub repo name
 * @param {object} callbacks - Progress/cancel callbacks
 * @param {function} callbacks.onProgress - Called with (pct, message)
 * @param {function} callbacks.isCancelled - Returns true if migration should stop
 * @returns {Promise<{ issuesCreated: number, labelsCreated: number }>}
 */
async function migrateWorkItems(config, azureCreds, githubToken, targetOwner, targetRepo, callbacks) {
  const { org, project, types, labelMapping = {} } = config
  const { pat } = azureCreds
  const onProgress = callbacks?.onProgress || (() => {})
  const isCancelled = callbacks?.isCancelled || (() => false)

  let issuesCreated = 0
  let labelsCreated = 0

  onProgress(0, 'Querying work items from Azure DevOps...')

  // Step 1: Query work item IDs via WIQL
  const escapedProject = escapeWiql(project)
  const wiqlTypes = types && types.length > 0
    ? types.map(t => `'${escapeWiql(t)}'`).join(', ')
    : null
  const wiqlQuery = wiqlTypes
    ? `SELECT [System.Id] FROM workitems WHERE [System.TeamProject] = '${escapedProject}' AND [System.WorkItemType] IN (${wiqlTypes})`
    : `SELECT [System.Id] FROM workitems WHERE [System.TeamProject] = '${escapedProject}'`

  // Use the WIQL endpoint to get IDs first
  const wiqlRes = await fetch(
    `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`,
    {
      method: 'POST',
      headers: {
        'Authorization': basicAuthHeader('', pat),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: wiqlQuery })
    }
  )

  if (!wiqlRes.ok) {
    const errBody = await wiqlRes.json().catch(() => null)
    throw new Error(errBody?.message || `WIQL query failed: ${wiqlRes.status}`)
  }

  const wiqlData = await wiqlRes.json()
  const workItemIds = (wiqlData.workItems || []).map(wi => wi.id)

  if (workItemIds.length === 0) {
    onProgress(100, 'No work items found')
    return { issuesCreated: 0, labelsCreated: 0 }
  }

  onProgress(5, `Found ${workItemIds.length} work items. Fetching details...`)

  if (isCancelled()) return { issuesCreated, labelsCreated }

  // Step 2: Fetch full work item details (with relations)
  const rawItems = await fetchWorkItems(org, project, pat, workItemIds)
  const normalizedItems = rawItems.map(normalizeWorkItem)

  onProgress(15, 'Building dependency tree...')

  if (isCancelled()) return { issuesCreated, labelsCreated }

  // Step 3: Build dependency tree (parents before children)
  const orderedItems = buildDependencyTree(normalizedItems)

  onProgress(20, 'Fetching existing labels from GitHub...')

  // Step 4: Fetch existing labels
  const existingLabels = await fetchExistingLabels(githubToken, targetOwner, targetRepo)

  if (isCancelled()) return { issuesCreated, labelsCreated }

  // Step 5: Create issues in dependency order
  const adoIdToGithubIssue = new Map() // ADO work item ID → GitHub issue number
  const total = orderedItems.length

  for (let i = 0; i < total; i++) {
    if (isCancelled()) break

    const item = orderedItems[i]
    const pct = 20 + Math.round((i / total) * 75)
    onProgress(pct, `Creating issue ${i + 1}/${total}: ${item.title}`)

    // Build labels for this item
    const labels = buildLabels(item.type, item.state, item.priority, labelMapping)

    // Ensure all labels exist on the repo
    for (const label of labels) {
      const created = await ensureLabel(label, githubToken, targetOwner, targetRepo, existingLabels)
      if (created) labelsCreated++
    }

    // Build hierarchy links from already-created issues
    const hierarchyLinks = {}
    if (item.relations) {
      for (const rel of item.relations) {
        if (rel.rel === 'System.LinkTypes.Hierarchy-Reverse') {
          const match = rel.url.match(/\/workItems\/(\d+)/)
          if (match) {
            const parentAdoId = parseInt(match[1], 10)
            const parentGhIssue = adoIdToGithubIssue.get(parentAdoId)
            if (parentGhIssue) {
              hierarchyLinks.parentIssue = parentGhIssue
            }
          }
        }
        if (rel.rel === 'System.LinkTypes.Hierarchy-Forward') {
          const match = rel.url.match(/\/workItems\/(\d+)/)
          if (match) {
            const childAdoId = parseInt(match[1], 10)
            const childGhIssue = adoIdToGithubIssue.get(childAdoId)
            if (childGhIssue) {
              if (!hierarchyLinks.childIssues) hierarchyLinks.childIssues = []
              hierarchyLinks.childIssues.push(childGhIssue)
            }
          }
        }
      }
    }

    const hasLinks = hierarchyLinks.parentIssue || (hierarchyLinks.childIssues && hierarchyLinks.childIssues.length > 0)
    const body = buildIssueBody(item, hasLinks ? hierarchyLinks : undefined)

    // Create the GitHub Issue
    const created = await createGitHubIssue({
      title: item.title,
      body,
      labels,
      githubToken,
      owner: targetOwner,
      repo: targetRepo
    })

    adoIdToGithubIssue.set(item.id, created.number)
    issuesCreated++
  }

  onProgress(100, `Migration complete: ${issuesCreated} issues created`)

  return { issuesCreated, labelsCreated }
}

export {
  migrateWorkItems,
  buildIssueBody,
  buildLabels,
  buildDependencyTree,
  htmlToMarkdown,
  isAllowedAttachmentUrl,
  normalizeWorkItem,
  ensureLabel,
  createGitHubIssue,
  fetchExistingLabels,
  generateLabelColor
}
