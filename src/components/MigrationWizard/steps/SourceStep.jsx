import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Cloud, KeyRound, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  ExternalLink, Link2, Server, Globe, ShieldCheck, Info, X,
  Keyboard, FolderGit2, AlertTriangle,
} from 'lucide-react'
import { parseAzureUrl } from '../../../utils/azureUrlParser'
import { Select } from '../../ui/Select'

const DEBOUNCE_MS = 400

export default function SourceStep({ source, onChange, oauthHook, orgsHook }) {
  // ── local UI state ─────────────────────────────────────────────────────
  const [envAuthAvailable, setEnvAuthAvailable] = useState(null)
  const [oauthConfigured, setOauthConfigured] = useState(null)
  const [credLoading, setCredLoading] = useState(true)
  const [showPat, setShowPat] = useState(false)
  const [projects, setProjects] = useState([])
  const [projectMeta, setProjectMeta] = useState({}) // { [projectName]: { repoCount, vcType, state } }
  const [validating, setValidating] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [smartPasteValue, setSmartPasteValue] = useState('')
  const [urlPreview, setUrlPreview] = useState(null) // { org, project, repo } — pending confirmation
  const [oauthHintDismissed, setOauthHintDismissed] = useState(
    () => { try { return sessionStorage.getItem('azure-oauth-hint-dismissed') === 'true' } catch { return false } }
  )
  const [manualOrgMode, setManualOrgMode] = useState(false) // fallback from dropdown to input
  const [switchingAuth, setSwitchingAuth] = useState(false) // double-click guard
  const debounceRef = useRef(null)
  const validationAbortRef = useRef(null)

  // ── destructure hooks ────────────────────────────────────────────────
  const { oauthStatus: oauthStatusValue, startOAuth, retryOAuth, pausePolling, resumePolling } = oauthHook
  const {
    organizations, orgsLoading, orgsError, orgProjectCounts,
    fetchOrganizations, fetchProjectCounts, clearCache: _clearOrgCache,
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

    // Cancel in-flight validation
    if (validationAbortRef.current) validationAbortRef.current.abort()

    if (source.credentialMode === 'oauth' && newMode !== 'oauth') {
      pausePolling()
    }
    if (newMode === 'oauth' && source.credentialMode !== 'oauth') {
      if (oauthStatusValue === 'pending') resumePolling()
      setManualOrgMode(false)
    }

    // Preserve org value across transitions
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

    // Abort previous
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

      // auto-select project from URL paste
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
      // Fetch repo count for each project (limited concurrency)
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

  // ── project dropdown change ────────────────────────────────────────────
  const handleProjectChange = useCallback((val) => {
    onChange({ project: val })
  }, [onChange])

  // ── org dropdown options for OAuth ────────────────────────────────────
  const orgDropdownSections = useMemo(() => {
    if (!organizations || organizations.length === 0) return []

    // Check sessionStorage for recents
    let recents = []
    try {
      recents = JSON.parse(sessionStorage.getItem('azure-recent-orgs') || '[]').slice(0, 3)
    } catch { /* ignore */ }

    const allOrgOptions = organizations.map(o => {
      const count = orgProjectCounts?.[o.accountName]
      return {
        value: o.accountName,
        label: o.accountName,
        icon: Cloud,
        badge: count === null ? '...' : count === undefined ? null : count === -1 ? '—' : `${count} proj`,
        badgeColor: count === -1 ? 'text-amber-500' : 'text-slate-500 dark:text-slate-400',
      }
    })

    const sections = []
    const recentOrgs = allOrgOptions.filter(o => recents.includes(o.value))
    if (recentOrgs.length > 0) {
      sections.push({ title: 'Recentes', options: recentOrgs })
      const remainingOrgs = allOrgOptions.filter(o => !recents.includes(o.value))
      if (remainingOrgs.length > 0) {
        sections.push({ title: 'Todas', options: remainingOrgs })
      }
    } else {
      sections.push({ title: undefined, options: allOrgOptions })
    }

    return sections
  }, [organizations, orgProjectCounts])

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

  // ── project dropdown options ──────────────────────────────────────────
  const projectOptions = useMemo(() => {
    return projects.map(p => {
      const meta = projectMeta[p.name]
      const isInactive = p.state && p.state !== 'wellFormed'
      const repoCount = meta?.repoCount
      const vcType = meta?.vcType || 'Git'

      let badge = null
      if (repoCount === -1) badge = '—'
      else if (repoCount === undefined || repoCount === null) badge = '...'
      else if (vcType === 'Tfvc' && repoCount > 0) badge = `Tfvc + Git · ${repoCount} ${repoCount === 1 ? 'repo' : 'repos'}`
      else if (vcType === 'Tfvc') badge = 'Tfvc'
      else badge = `Git · ${repoCount} ${repoCount === 1 ? 'repo' : 'repos'}`

      if (isInactive) badge = `Inactivo · ${badge || '0 repos'}`

      return {
        value: p.name,
        label: p.name,
        icon: FolderGit2,
        badge,
        badgeColor: isInactive ? 'text-amber-500 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400',
        muted: isInactive,
      }
    })
  }, [projects, projectMeta])

  const projectFooter = useMemo(() => {
    if (projects.length === 0) return null
    const active = projects.filter(p => !p.state || p.state === 'wellFormed').length
    const inactive = projects.length - active
    if (inactive > 0) return `${active} activos · ${inactive} inactivos`
    return `${active} projectos`
  }, [projects])

  // ── validation status badge ────────────────────────────────────────────
  const orgStatusBadge = useMemo(() => {
    if (validating) {
      return { text: 'A validar...', color: 'text-slate-400 dark:text-slate-500', dot: 'bg-slate-400', icon: Loader2, spin: true }
    }
    if (source.validated) {
      const count = projects.length
      return { text: `Conectada · ${count} proj`, color: 'text-emerald-500 dark:text-emerald-400', dot: 'bg-emerald-500' }
    }
    if (validationError) {
      if (validationError.includes('401') || validationError.includes('403') || validationError.includes('insufficient')) {
        return { text: 'Sem acesso a esta org', color: 'text-amber-500 dark:text-amber-400', dot: 'bg-amber-500' }
      }
      if (validationError.includes('not found') || validationError.includes('404')) {
        return { text: 'Org não encontrada', color: 'text-red-400 dark:text-red-400', dot: 'bg-red-400' }
      }
      return { text: 'Erro de ligação', color: 'text-red-400 dark:text-red-400', dot: 'bg-red-400' }
    }
    return null
  }, [validating, source.validated, validationError, projects.length])

  // ── connection summary ─────────────────────────────────────────────────
  const connectionSummary = source.validated && source.project && source.org
  const authLabel = source.credentialMode === 'serverPat' ? 'Server PAT'
    : source.credentialMode === 'personalPat' ? 'Personal PAT'
    : source.credentialMode === 'oauth' ? 'OAuth'
    : ''
  const AuthIcon = source.credentialMode === 'serverPat' ? Server
    : source.credentialMode === 'personalPat' ? KeyRound
    : ShieldCheck

  // ── PAT error is access-related ──────────────────────────────────────
  const isAccessError = validationError && (
    validationError.includes('401') || validationError.includes('403') ||
    validationError.includes('insufficient') || validationError.includes('Invalid')
  )

  // ── parsed badge for smart paste ───────────────────────────────────────
  const parsedBadge = smartPasteValue ? parseAzureUrl(smartPasteValue) : null

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Connection summary badge */}
      <AnimatePresence>
        {connectionSummary && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                {source.org} / {source.project}
              </span>
              <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <AuthIcon className="w-3 h-3" />
                {authLabel}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Smart URL paste */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          Paste Azure DevOps URL <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={smartPasteValue}
            onChange={(e) => handleUrlInput(e.target.value)}
            placeholder="https://dev.azure.com/org/project or org/project/repo"
            className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
          />
        </div>

        {/* URL preview with confirm/discard */}
        <AnimatePresence>
          {urlPreview && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                <span className="text-xs text-slate-500 dark:text-slate-400">URL detectada:</span>
                <div className="flex items-center gap-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                  {urlPreview.org && (
                    <span className="flex items-center gap-1">
                      <Cloud className="w-3 h-3" /> {urlPreview.org}
                    </span>
                  )}
                  {urlPreview.project && (
                    <>
                      <span className="text-slate-400">→</span>
                      <span className="flex items-center gap-1">
                        <FolderGit2 className="w-3 h-3" /> {urlPreview.project}
                      </span>
                    </>
                  )}
                  {urlPreview.repo && (
                    <>
                      <span className="text-slate-400">→</span>
                      <span>{urlPreview.repo}</span>
                    </>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={applyUrlPreview}
                    className="px-2 py-0.5 text-xs font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
                  >
                    Preencher
                  </button>
                  <button
                    type="button"
                    onClick={dismissUrlPreview}
                    className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    aria-label="Descartar"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Fallback: show parsed badges if no preview (error messages) */}
        {!urlPreview && parsedBadge?.error && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{parsedBadge.error}</p>
        )}
      </div>

      {/* Organization — Smart Field */}
      <div>
        <label htmlFor="azure-org" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          Organization
        </label>

        <AnimatePresence mode="wait">
          {isDropdownMode ? (
            /* OAuth dropdown mode */
            <motion.div
              key="org-dropdown"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Select
                value={source.org}
                onChange={handleOrgDropdownChange}
                placeholder="Selecionar organização..."
                sections={orgDropdownSections}
                searchable
                loading={orgsLoading}
                label="Organization"
                onOpen={handleOrgDropdownOpen}
                emptyState={
                  orgsError ? (
                    <div className="px-3 py-4 text-center">
                      <p className="text-sm text-red-500 dark:text-red-400 mb-2">
                        {orgsError === 'TOKEN_EXPIRED' ? 'Sessão expirada — autentique novamente' : orgsError}
                      </p>
                      <button
                        type="button"
                        onClick={fetchOrganizations}
                        className="text-xs text-indigo-500 hover:text-indigo-400 underline"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  ) : (
                    <div className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                      Nenhuma organização encontrada para esta conta
                    </div>
                  )
                }
                extraOption={
                  <button
                    type="button"
                    onClick={() => setManualOrgMode(true)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-t border-slate-200 dark:border-slate-700"
                    aria-label="Introduzir organização manualmente"
                  >
                    <Keyboard className="w-4 h-4" />
                    Ou digitar manualmente...
                  </button>
                }
                footer={organizations?.length > 0 ? `${organizations.length} orgs disponíveis` : undefined}
              />
            </motion.div>
          ) : (
            /* PAT / manual input mode */
            <motion.div
              key="org-input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="relative">
                <Cloud className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="azure-org"
                  type="text"
                  value={source.org}
                  onChange={handleOrgInputChange}
                  placeholder="my-organization"
                  className={`w-full pl-9 pr-44 py-2.5 border rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors ${
                    isAccessError ? 'border-amber-400 dark:border-amber-500' : 'border-slate-300 dark:border-slate-600'
                  }`}
                />
                {/* Status badge inline */}
                <AnimatePresence mode="wait">
                  {source.org && orgStatusBadge && (
                    <motion.div
                      key={orgStatusBadge.text}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5"
                      aria-live="polite"
                    >
                      {orgStatusBadge.spin ? (
                        <Loader2 className={`w-3 h-3 ${orgStatusBadge.color} animate-spin`} />
                      ) : (
                        <motion.span
                          initial={{ scale: 1 }}
                          animate={{ scale: [1, 1.3, 1] }}
                          transition={{ duration: 0.3 }}
                          className={`w-2 h-2 rounded-full ${orgStatusBadge.dot}`}
                        />
                      )}
                      <span className={`text-xs font-medium ${orgStatusBadge.color}`}>
                        {orgStatusBadge.text}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Back to dropdown link (if was in manual mode from OAuth) */}
              {manualOrgMode && isOAuthMode && oauthStatusValue === 'success' && (
                <button
                  type="button"
                  onClick={() => setManualOrgMode(false)}
                  className="mt-1 text-xs text-indigo-500 hover:text-indigo-400 underline"
                >
                  ← Voltar à lista de organizações
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* OAuth upgrade hint */}
        <AnimatePresence>
          {!isOAuthMode && oauthConfigured && !oauthHintDismissed && source.org && source.validated && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, delay: 0.5 }}
              className="overflow-hidden"
              role="status"
            >
              <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <p className="text-xs text-indigo-300 dark:text-indigo-300 flex-1">
                  OAuth permite listar todas as suas organizações automaticamente
                </p>
                <button
                  type="button"
                  onClick={() => handleModeSwitch('oauth')}
                  className="text-xs font-medium text-indigo-400 hover:text-indigo-300 shrink-0"
                >
                  Trocar →
                </button>
                <button
                  type="button"
                  onClick={() => { setOauthHintDismissed(true); try { sessionStorage.setItem('azure-oauth-hint-dismissed', 'true') } catch { /* ignore */ } }}
                  className="text-slate-400 hover:text-slate-300 shrink-0"
                  aria-label="Descartar sugestão"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PAT access error — contextual actions */}
        <AnimatePresence>
          {isAccessError && !validating && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      Este PAT não tem permissões para "{source.org}"
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <a
                        href={`https://dev.azure.com/${encodeURIComponent(source.org)}/_usersSettings/tokens`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-500 underline"
                      >
                        <KeyRound className="w-3 h-3" />
                        Criar PAT para esta org
                      </a>
                      {oauthConfigured && (
                        <button
                          type="button"
                          onClick={() => handleModeSwitch('oauth')}
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-500 hover:text-indigo-400 underline"
                        >
                          <Globe className="w-3 h-3" />
                          Trocar p/ OAuth
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Credential Cards */}
      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Authentication</p>
        {credLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">

            {/* Card 1 — Server PAT */}
            <CredCard
              mode="serverPat"
              icon={Server}
              label="Server PAT"
              subtitle="Configured in the server .env file — no credentials entered here."
              available={envAuthAvailable}
              active={source.credentialMode === 'serverPat'}
              onSelect={handleModeSwitch}
            >
              {!envAuthAvailable && (
                <pre className="text-xs bg-slate-800 text-slate-300 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{`Add to your server .env file:\n  AZURE_PAT=<your-personal-access-token>\nThen restart the server.`}</pre>
              )}
            </CredCard>

            {/* Card 2 — Personal PAT */}
            <CredCard
              mode="personalPat"
              icon={KeyRound}
              label="Personal Access Token"
              subtitle="Paste your own PAT — used only for this session, never persisted."
              available={true}
              active={source.credentialMode === 'personalPat'}
              onSelect={handleModeSwitch}
            >
              {source.credentialMode === 'personalPat' && (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      type={showPat ? 'text' : 'password'}
                      value={source.pat}
                      onChange={(e) => onChange({ pat: e.target.value, validated: false })}
                      placeholder="Paste your Personal Access Token"
                      className="w-full pr-10 pl-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 text-sm transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPat((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                      aria-label={showPat ? 'Hide PAT' : 'Show PAT'}
                    >
                      {showPat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>Minimum scope: Code (Read). Add Work Items (Read) + Wiki (Read) for full migration.</span>
                    {source.org && (
                      <a
                        href={`https://dev.azure.com/${encodeURIComponent(source.org)}/_usersSettings/tokens`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-500 hover:text-indigo-400 inline-flex items-center gap-1 shrink-0 ml-2"
                      >
                        Create PAT <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </CredCard>

            {/* Card 3 — OAuth */}
            <CredCard
              mode="oauth"
              icon={ShieldCheck}
              label="OAuth / Browser Login"
              subtitle="Authenticate via Azure AD — token stored in server session only."
              available={oauthConfigured}
              active={source.credentialMode === 'oauth'}
              onSelect={handleModeSwitch}
              extra={oauthConfigured && source.credentialMode !== 'oauth' ? (
                <span className="text-[10px] text-indigo-400">Lista orgs automaticamente</span>
              ) : null}
            >
              {!oauthConfigured ? (
                <pre className="text-xs bg-slate-800 text-slate-300 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{`1. Register an app in Azure Portal (Azure Active Directory → App Registrations).\n2. Set Redirect URI to: http://localhost:3001/api/azure/oauth/callback\n3. Add to your server .env file:\n     AZURE_CLIENT_ID=<app-client-id>\n     AZURE_CLIENT_SECRET=<app-client-secret>\n     AZURE_TENANT_ID=<tenant-id>  (or "common" for multi-tenant)\n4. Restart the server.`}</pre>
              ) : source.credentialMode === 'oauth' ? (
                <div className="space-y-2">
                  {oauthStatusValue === 'idle' && (
                    <button
                      type="button"
                      onClick={() => {
                        const popup = window.open('/api/azure/oauth/start', '_blank')
                        if (!popup) {
                          setValidationError('Popup blocked — allow popups for this page and try again.')
                          return
                        }
                        startOAuth()
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
                    >
                      <Globe className="w-4 h-4" />
                      Open browser to authenticate
                    </button>
                  )}
                  {oauthStatusValue === 'pending' && (
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Waiting for browser authentication...
                    </div>
                  )}
                  {oauthStatusValue === 'success' && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      Authenticated
                    </span>
                  )}
                  {(oauthStatusValue === 'error' || oauthStatusValue === 'timeout') && (
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                      <XCircle className="w-4 h-4" />
                      {oauthStatusValue === 'timeout' ? 'Authentication timed out — ' : 'Authentication error — '}
                      <button type="button" onClick={retryOAuth} className="underline">try again</button>
                    </div>
                  )}
                </div>
              ) : null}
            </CredCard>

          </div>
        )}
      </div>

      {/* Validation status (non-access errors only) */}
      {source.validated && !connectionSummary && (
        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          Connected
        </span>
      )}
      {validationError && !validating && !isAccessError && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <XCircle className="w-4 h-4 shrink-0" />
          {validationError}
          <button type="button" onClick={runValidation} className="underline ml-1">Retry</button>
        </div>
      )}

      {/* Project Dropdown — enriched */}
      {source.validated && (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Project
          </label>
          <Select
            value={source.project}
            onChange={handleProjectChange}
            placeholder="Selecionar projecto..."
            options={projectOptions}
            searchable={projects.length > 5}
            label="Project"
            footer={projectFooter}
          />
        </div>
      )}

    </div>
  )
}

// ── CredCard ──────────────────────────────────────────────────────────────
function CredCard({ mode, icon: Icon, label, subtitle, available, active, onSelect, children, extra }) {
  const selectable = available !== false
  return (
    <div
      onClick={() => selectable && onSelect(mode)}
      className={`rounded-xl border p-4 transition-all
        ${selectable ? 'cursor-pointer' : 'cursor-default opacity-60'}
        ${active && selectable
          ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}
      `}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
          <Icon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</span>
            {available === true && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">Configured</span>
            )}
            {available === false && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">Not configured</span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
          {extra && <div className="mt-0.5">{extra}</div>}
        </div>
        {active && selectable && <CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0" />}
      </div>
      {(!selectable || active) && children && (
        <div className="mt-3">{children}</div>
      )}
    </div>
  )
}
