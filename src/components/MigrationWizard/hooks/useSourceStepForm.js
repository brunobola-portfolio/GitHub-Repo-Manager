import { useState, useEffect, useRef, useCallback } from 'react'
import { parseAzureUrl } from '../../../utils/azureUrlParser'

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
  const debounceRef = useRef(null)
  const validationAbortRef = useRef(null)

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

  // ── smart URL paste ────────────────────────────────────────────────────
  const handleUrlInput = useCallback((value) => {
    setSmartPasteValue(value)
    const parsed = parseAzureUrl(value)
    if (parsed.org || parsed.project || parsed.repo) {
      setUrlPreview({
        org: parsed.org || null,
        project: parsed.project || null,
        repo: parsed.repo || null,
      })
    } else {
      setUrlPreview(null)
    }
  }, [])

  const applyUrlPreview = useCallback(() => {
    if (!urlPreview) return
    const updates = { validated: false }
    if (urlPreview.org) updates.org = urlPreview.org
    if (urlPreview.project) updates.urlParsedProject = urlPreview.project
    if (urlPreview.repo) updates.urlParsedRepo = urlPreview.repo
    onChange(updates)
    setProjects([])
    setValidationError('')
    setUrlPreview(null)
    setManualOrgMode(false)
  }, [urlPreview, onChange])

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
  const credentialReady = (
    (source.credentialMode === 'serverPat' && envAuthAvailable) ||
    (source.credentialMode === 'personalPat' && source.pat?.trim()) ||
    (source.credentialMode === 'oauth' && oauthStatusValue === 'success')
  )

  const runValidation = useCallback(async () => {
    if (!source.org?.trim() || !credentialReady) return

    if (validationAbortRef.current) validationAbortRef.current.abort()
    const controller = new AbortController()
    validationAbortRef.current = controller

    setValidating(true)
    setValidationError('')
    try {
      const body = {
        org: source.org,
        pat: source.credentialMode === 'personalPat' ? source.pat : undefined,
      }
      const fetchOpts = {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
      const [validateRes, projectsRes] = await Promise.all([
        fetch('/api/azure/validate', fetchOpts),
        fetch('/api/azure/projects', { ...fetchOpts, body: JSON.stringify(body) }),
      ])

      if (controller.signal.aborted) return

      const validateData = await validateRes.json()
      if (!validateData.valid) {
        onChange({ validated: false })
        setValidationError(validateData.error || 'Invalid credentials')
        return
      }
      const projectsData = await projectsRes.json()
      const list = projectsData.projects || []
      onChange({ validated: true })
      setProjects(list)

      const match = source.urlParsedProject && list.find((p) => p.name === source.urlParsedProject)
      if (match) onChange({ project: match.name })
    } catch (e) {
      if (e.name === 'AbortError') return
      onChange({ validated: false })
      setValidationError(e.message || 'Connection error')
    } finally {
      setValidating(false)
    }
  }, [source.org, source.pat, source.credentialMode, source.urlParsedProject, credentialReady, onChange])

  // debounced trigger for org / pat changes
  useEffect(() => {
    if (!source.org?.trim() || !credentialReady) return
    if (source.credentialMode === 'serverPat' || oauthStatusValue === 'success') {
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
    const pat = source.credentialMode === 'personalPat' ? source.pat : undefined

    let cancelled = false
    const fetchMeta = async () => {
      const meta = {}
      const queue = [...projects]
      const run = async () => {
        while (queue.length > 0) {
          if (cancelled) return
          const p = queue.shift()
          try {
            const res = await fetch('/api/azure/repos', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ org, project: p.name, pat }),
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
      await Promise.all(Array.from({ length: Math.min(3, projects.length) }, () => run()))
    }
    fetchMeta()
    return () => { cancelled = true }
  }, [source.validated, source.org, source.pat, source.credentialMode, projects])

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
