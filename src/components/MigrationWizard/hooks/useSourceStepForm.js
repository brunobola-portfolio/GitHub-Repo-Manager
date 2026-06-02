import { useState, useEffect, useRef, useCallback } from 'react'
import { parseAzureUrl } from '../../../utils/azureUrlParser'
import { getCsrfToken } from '../../../utils/api'
import { isAbort } from '../../../utils/errorClassification'

const DEBOUNCE_MS = 400

/**
 * Encapsulates form state + side effects for SourceStep:
 *  - credential panel bootstrap (env PAT + OAuth availability)
 *  - smart URL paste parsing
 *  - credential mode switching
 *  - auto-validation (org + PAT / OAuth)
 *  - project metadata (repo counts) lazy fetch
 *  - org handlers (input vs dropdown) and recents
 *
 * Keeps the render surface of SourceStep focused on layout only.
 */
export function useSourceStepForm({ source, onChange, oauthHook, orgsHook }) {
  const [envAuthAvailable, setEnvAuthAvailable] = useState(null)
  const [oauthConfigured, setOauthConfigured] = useState(null)
  const [credLoading, setCredLoading] = useState(true)
  const [showPat, setShowPat] = useState(false)
  const [projects, setProjects] = useState([])
  const [projectMeta, setProjectMeta] = useState({})
  const [validating, setValidating] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [smartPasteValue, setSmartPasteValue] = useState('')
  const [urlPreview, setUrlPreview] = useState(null)
  const [oauthHintDismissed, setOauthHintDismissed] = useState(
    () => { try { return sessionStorage.getItem('azure-oauth-hint-dismissed') === 'true' } catch { return false } }
  )
  const [manualOrgMode, setManualOrgMode] = useState(false)
  const [switchingAuth, setSwitchingAuth] = useState(false)
  const [hostAllowlist, setHostAllowlist] = useState({ patterns: [], usingDefault: true, allowed: null, canEdit: false })
  const debounceRef = useRef(null)
  const validationAbortRef = useRef(null)
  // Flag set when the backend's auto-discovery rewrites source.org to a
  // collection-prefixed form (e.g., `Trigenius` → `tfs/Trigenius`).
  // The debounce effect watches source.org and would otherwise re-fire
  // validation with the new org — causing a spurious 400 in the network
  // tab while the abort controller catches up. Skip exactly that one tick.
  const orgRewrittenInternallyRef = useRef(false)

  const { oauthStatus: oauthStatusValue, startOAuth, retryOAuth, pausePolling, resumePolling } = oauthHook
  const {
    organizations, orgsLoading, orgsError, orgProjectCounts,
    fetchOrganizations, fetchProjectCounts,
  } = orgsHook || {}

  const isOAuthMode = source.credentialMode === 'oauth'
  const isDropdownMode = isOAuthMode && oauthStatusValue === 'success' && !manualOrgMode

  // ── initialise credential panel ────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/azure/env-auth', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/azure/oauth-status', { credentials: 'include' }).then((r) => r.json()),
    ])
      .then(([envAuth, oauthStatus]) => {
        setEnvAuthAvailable(envAuth.available)
        setOauthConfigured(oauthStatus.configured)
        if (!source.credentialMode) {
          onChange({ credentialMode: envAuth.available ? 'serverPat' : 'personalPat' })
        }
      })
      .catch(() => {
        setEnvAuthAvailable(false)
        setOauthConfigured(false)
        if (!source.credentialMode) onChange({ credentialMode: 'personalPat' })
      })
      .finally(() => setCredLoading(false))
  }, [onChange, source.credentialMode])

  // ── auto-fetch orgs when OAuth becomes successful ────────────────────
  useEffect(() => {
    if (oauthStatusValue === 'success' && fetchOrganizations) {
      fetchOrganizations()
    }
  }, [oauthStatusValue, fetchOrganizations])

  // ── fetch allowlist whenever host changes, so the UI can show whether
  // the current host is permitted by the server before validation runs.
  // `refreshKey` lets callers force a re-fetch (e.g., after admin adds a
  // host via the AllowlistFixPanel button).
  const [allowlistRefreshKey, setAllowlistRefreshKey] = useState(0)
  const refreshAllowlist = useCallback(() => setAllowlistRefreshKey((k) => k + 1), [])

  useEffect(() => {
    if (!source.host) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears derived state when source goes away
      setHostAllowlist({ patterns: [], usingDefault: true, allowed: null, canEdit: false })
      return
    }
    let cancelled = false
    fetch(`/api/azure/host-allowlist?host=${encodeURIComponent(source.host)}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data) return
        setHostAllowlist({
          patterns: data.patterns || [],
          usingDefault: !!data.usingDefault,
          allowed: data.allowed,
          canEdit: !!data.canEdit,
        })
      })
      .catch(() => { /* leave previous state */ })
    return () => { cancelled = true }
  }, [source.host, allowlistRefreshKey])

  // ── smart URL paste ────────────────────────────────────────────────────
  // When the user types/pastes a valid URL, immediately push host+org+project
  // into wizard state — no extra "Aplicar" click required. This eliminates the
  // confusing intermediate state where the preview was shown but state wasn't
  // updated, leaving downstream code (PAT link, validation) to silently fall
  // back to dev.azure.com.
  //
  // We still set urlPreview as a transient visual confirmation (auto-dismisses
  // after a short delay), but applying is no longer gated on a click.
  const handleUrlInput = useCallback((value) => {
    setSmartPasteValue(value)
    const parsed = parseAzureUrl(value)

    const hasUsefulData = parsed.host || parsed.org || parsed.project || parsed.repo
    if (!hasUsefulData) {
      setUrlPreview(null)
      return
    }

    // Show preview (lets user see what was detected)
    setUrlPreview({
      host: parsed.host || null,
      org: parsed.org || null,
      project: parsed.project || null,
      repo: parsed.repo || null,
    })

    // AUTO-APPLY: push values into wizard state immediately
    const updates = { validated: false }
    if (parsed.host) updates.host = parsed.host
    if (parsed.org) updates.org = parsed.org
    if (parsed.project) updates.urlParsedProject = parsed.project
    if (parsed.repo) updates.urlParsedRepo = parsed.repo

    // Smart credential mode: on-prem hosts almost always need a personal
    // PAT (server's .env token is typically cloud-scoped). Switch the user
    // before they hit a confusing 401.
    const hostLower = (parsed.host || '').toLowerCase().split(':')[0]
    const currentHostLower = (source.host || '').toLowerCase().split(':')[0]
    const isCloudHost = hostLower === 'dev.azure.com' || hostLower.endsWith('.visualstudio.com')
    if (!isCloudHost && hostLower && source.credentialMode !== 'personalPat') {
      updates.credentialMode = 'personalPat'
    }

    // Stored credentials and pasted PATs are host-scoped. When the user
    // pastes a URL for a different host, the previous credential won't
    // authenticate against it (it was either created for cloud or a
    // different on-prem server) and produces a confusing silent 401.
    // Wipe the stale auth state so the user is prompted afresh — the
    // SavedCredentialsPicker re-filters by the new host automatically.
    const hostChanged = hostLower && currentHostLower && hostLower !== currentHostLower
    if (hostChanged) {
      updates.savedCredentialId = null
      updates.pat = ''
    }

    if (Object.keys(updates).length > 1) {
      onChange(updates)
      setProjects([])
      setProjectMeta({})
      setValidationError('')
      setManualOrgMode(false)
    }
  }, [onChange, source.credentialMode, source.host])

  // applyUrlPreview is now a no-op confirmation (state already applied in
  // handleUrlInput). Kept as a callback so existing UI props don't break.
  // Clicking it just dismisses the preview chrome.
  const applyUrlPreview = useCallback(() => {
    setUrlPreview(null)
  }, [])

  const dismissUrlPreview = useCallback(() => {
    setUrlPreview(null)
  }, [])

  // ── credential mode switch ─────────────────────────────────────────────
  const handleModeSwitch = useCallback((newMode) => {
    if (newMode === source.credentialMode || switchingAuth) return

    setSwitchingAuth(true)
    setTimeout(() => setSwitchingAuth(false), 500)

    if (validationAbortRef.current) validationAbortRef.current.abort()

    if (source.credentialMode === 'oauth' && newMode !== 'oauth') {
      pausePolling()
    }
    if (newMode === 'oauth' && source.credentialMode !== 'oauth') {
      if (oauthStatusValue === 'pending') resumePolling()
      setManualOrgMode(false)
    }

    onChange({ credentialMode: newMode, validated: false })
    setProjects([])
    setValidationError('')
  }, [source.credentialMode, oauthStatusValue, switchingAuth, pausePolling, resumePolling, onChange])

  // ── auto-validate ──────────────────────────────────────────────────────
  // A saved credential from the vault counts as "ready" for the personalPat
  // mode — the backend decrypts it server-side; the browser never sees the PAT.
  const credentialReady = (
    (source.credentialMode === 'serverPat' && envAuthAvailable) ||
    (source.credentialMode === 'personalPat' && (source.pat?.trim() || source.savedCredentialId)) ||
    (source.credentialMode === 'oauth' && oauthStatusValue === 'success')
  )

  const runValidation = useCallback(async () => {
    if (!source.org?.trim() || !credentialReady) return
    // Hard gate: never silently pick a server. If host isn't set, surface
    // a clear instruction instead of fetching the wrong cloud and getting
    // a misleading 404.
    if (!source.host?.trim()) {
      setValidationError('Define o servidor primeiro — cola uma URL Azure DevOps / TFS no campo acima ou escolhe o servidor manualmente.')
      onChange({ validated: false })
      return
    }

    if (validationAbortRef.current) validationAbortRef.current.abort()
    const controller = new AbortController()
    validationAbortRef.current = controller

    setValidating(true)
    setValidationError('')
    try {
      const body = {
        host: source.host,
        org: source.org,
        // Prefer a saved-credential reference over the raw PAT — the
        // backend decrypts the stored token server-side so the browser
        // is never the source of truth for the credential.
        ...(source.credentialMode === 'personalPat'
          ? (source.savedCredentialId
              ? { savedCredentialId: source.savedCredentialId }
              : { pat: source.pat })
          : {}),
      }
      const csrfToken = await getCsrfToken().catch(() => null)
      const fetchOpts = {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
      // Sequential: validate first so any on-prem TFS path auto-discovery
      // (e.g., `Trigenius` → `tfs/Trigenius`) can rewrite the org before the
      // projects fetch uses it. Running these in parallel risks projects
      // probing the wrong collection path.
      const validateRes = await fetch('/api/azure/validate', fetchOpts)
      if (controller.signal.aborted) return
      const validateData = await validateRes.json().catch(() => ({}))
      // Backend may return HTTP 400 with { error } (e.g., decrypted PAT
      // couldn't be retrieved from the vault) or HTTP 200 with { valid: false }
      // for credential failures. Treat both as validation errors with the
      // exact backend message — never let the panel hang on "pending".
      if (!validateRes.ok || !validateData.valid) {
        onChange({ validated: false })
        const msg = validateData.error
          || validateData.message
          || (validateRes.status === 401 || validateRes.status === 403
              ? 'Credenciais rejeitadas pelo servidor (401/403)'
              : `Validação falhou (HTTP ${validateRes.status})`)
        setValidationError(msg)
        return
      }
      const effectiveOrg = validateData.resolvedOrg || source.org
      if (effectiveOrg !== source.org) {
        // Mark this rewrite as internally-triggered so the debounce
        // effect skips its next tick instead of firing a redundant
        // validate that races with our in-flight projects fetch.
        orgRewrittenInternallyRef.current = true
        onChange({ org: effectiveOrg })
      }
      const projectsBody = { ...body, org: effectiveOrg }
      const projectsRes = await fetch('/api/azure/projects', {
        ...fetchOpts,
        body: JSON.stringify(projectsBody),
      })
      if (controller.signal.aborted) return
      const projectsData = await projectsRes.json()
      if (!projectsRes.ok) {
        onChange({ validated: false })
        setValidationError(projectsData.error || `Failed to list projects (HTTP ${projectsRes.status})`)
        return
      }
      const list = projectsData.projects || []
      onChange({ validated: true })
      setProjects(list)

      // Try exact match first, then case-insensitive — TFS occasionally
      // normalises project names differently between URL paths and API.
      if (source.urlParsedProject) {
        const exact = list.find((p) => p.name === source.urlParsedProject)
        const ci = exact || list.find((p) => p.name?.toLowerCase() === source.urlParsedProject.toLowerCase())
        if (ci) onChange({ project: ci.name })
      }
    } catch (e) {
      if (isAbort(e)) return
      onChange({ validated: false })
      setValidationError(e.message || 'Connection error')
    } finally {
      setValidating(false)
    }
  }, [source.org, source.pat, source.host, source.savedCredentialId, source.credentialMode, source.urlParsedProject, credentialReady, onChange])

  // debounced trigger for org / pat changes
  useEffect(() => {
    // Skip one tick when our own auto-discovery rewrote source.org —
    // the in-flight runValidation already covers the new value via
    // its projects fetch. Re-validating here causes a redundant 400.
    if (orgRewrittenInternallyRef.current) {
      orgRewrittenInternallyRef.current = false
      return
    }
    if (!source.org?.trim() || !credentialReady) return
    if (source.credentialMode === 'serverPat' || oauthStatusValue === 'success') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- runValidation owns its own debounced state machine; calling sync here matches the no-debounce code path
      runValidation()
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(runValidation, DEBOUNCE_MS)
    return () => clearTimeout(debounceRef.current)
  }, [source.org, source.pat, source.credentialMode, oauthStatusValue, credentialReady, runValidation])

  // ── fetch project metadata (repo counts) lazily ──────────────────────
  useEffect(() => {
    if (!source.validated || projects.length === 0) return
    const org = source.org
    // Credential payload: prefer the saved-credential reference over the
    // raw PAT (backend decrypts server-side; browser never holds the value).
    // Without this, picking a saved token caused the metadata fetch to
    // POST with pat=undefined → 401 from the backend.
    const credPayload = source.credentialMode === 'personalPat'
      ? (source.savedCredentialId
          ? { savedCredentialId: source.savedCredentialId }
          : { pat: source.pat })
      : {}

    let cancelled = false
    const fetchMeta = async () => {
      const meta = {}
      // Cap the prefetch at the first 100 projects to protect on-prem TFS
      // backends from a request storm — large collections can have 1000+
      // projects, and the dropdown only shows badges for what the user is
      // actually scrolling. The currently-picked project is always prefetched
      // first so its badge populates immediately even when it's past the cap.
      const PREFETCH_CAP = 100
      const picked = source.project ? projects.find((p) => p.name === source.project) : null
      const rest = projects.filter((p) => p !== picked).slice(0, PREFETCH_CAP - (picked ? 1 : 0))
      const queue = picked ? [picked, ...rest] : rest
      const run = async () => {
        while (queue.length > 0) {
          if (cancelled) return
          const p = queue.shift()
          try {
            const csrfToken = await getCsrfToken().catch(() => null)
            const res = await fetch('/api/azure/repos', {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
              },
              body: JSON.stringify({ host: source.host || 'dev.azure.com', org, project: p.name, ...credPayload }),
            })
            const data = await res.json()
            meta[p.name] = {
              repoCount: (data.repos || []).length,
              vcType: data.versionControlType || 'Git',
              state: p.state,
            }
            if (!cancelled) setProjectMeta(prev => ({ ...prev, [p.name]: meta[p.name] }))
          } catch {
            meta[p.name] = { repoCount: -1, vcType: '?', state: p.state }
            if (!cancelled) setProjectMeta(prev => ({ ...prev, [p.name]: meta[p.name] }))
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => run()))
    }
    fetchMeta()
    return () => { cancelled = true }
  }, [source.validated, source.org, source.host, source.pat, source.savedCredentialId, source.credentialMode, source.project, projects])

  // ── org field handlers ─────────────────────────────────────────────────
  const handleOrgInputChange = useCallback((e) => {
    const val = e.target.value.replace(/[^a-zA-Z0-9-]/g, '')
    onChange({ org: val, validated: false, project: '' })
    setProjects([])
    setProjectMeta({})
    setValidationError('')
  }, [onChange])

  const handleOrgDropdownChange = useCallback((val) => {
    if (val === '__manual__') {
      setManualOrgMode(true)
      return
    }
    onChange({ org: val, validated: false, project: '' })
    setProjects([])
    setProjectMeta({})
    setValidationError('')
  }, [onChange])

  const handleProjectChange = useCallback((val) => {
    onChange({ project: val })
  }, [onChange])

  const handleOrgDropdownOpen = useCallback(() => {
    if (organizations?.length > 0 && fetchProjectCounts) {
      fetchProjectCounts(organizations.map(o => o.accountName))
    }
  }, [organizations, fetchProjectCounts])

  // Save org to recents when selected
  useEffect(() => {
    if (source.org && isDropdownMode) {
      try {
        const recents = JSON.parse(sessionStorage.getItem('azure-recent-orgs') || '[]')
        const updated = [source.org, ...recents.filter(r => r !== source.org)].slice(0, 3)
        sessionStorage.setItem('azure-recent-orgs', JSON.stringify(updated))
      } catch { /* ignore */ }
    }
  }, [source.org, isDropdownMode])

  const dismissOauthHint = useCallback(() => {
    setOauthHintDismissed(true)
    try { sessionStorage.setItem('azure-oauth-hint-dismissed', 'true') } catch { /* ignore */ }
  }, [])

  return {
    // state
    envAuthAvailable,
    oauthConfigured,
    credLoading,
    showPat,
    setShowPat,
    projects,
    projectMeta,
    validating,
    validationError,
    setValidationError,
    smartPasteValue,
    urlPreview,
    oauthHintDismissed,
    manualOrgMode,
    setManualOrgMode,
    hostAllowlist,
    refreshAllowlist,
    // derived
    isOAuthMode,
    isDropdownMode,
    // handlers
    handleUrlInput,
    applyUrlPreview,
    dismissUrlPreview,
    handleModeSwitch,
    runValidation,
    handleOrgInputChange,
    handleOrgDropdownChange,
    handleProjectChange,
    handleOrgDropdownOpen,
    dismissOauthHint,
    // passthrough (oauth + orgs)
    oauthStatusValue,
    startOAuth,
    retryOAuth,
    organizations,
    orgsLoading,
    orgsError,
    orgProjectCounts,
    fetchOrganizations,
  }
}
