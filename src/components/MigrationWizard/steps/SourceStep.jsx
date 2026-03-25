import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Cloud, KeyRound, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  ExternalLink, ChevronDown, Link2, Server, Globe, ShieldCheck,
} from 'lucide-react'
import { parseAzureUrl } from '../../../utils/azureUrlParser'

const DEBOUNCE_MS = 400

export default function SourceStep({ source, onChange, oauthHook }) {
  // ── local UI state ─────────────────────────────────────────────────────
  const [envAuthAvailable, setEnvAuthAvailable] = useState(null)
  const [oauthConfigured, setOauthConfigured] = useState(null)
  const [credLoading, setCredLoading] = useState(true)
  const [showPat, setShowPat] = useState(false)
  const [projects, setProjects] = useState([])
  const [validating, setValidating] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [smartPasteValue, setSmartPasteValue] = useState('')
  const debounceRef = useRef(null)

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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── smart URL paste ────────────────────────────────────────────────────
  const handleUrlPaste = useCallback((value) => {
    const parsed = parseAzureUrl(value)
    const updates = {}
    if (parsed.org) updates.org = parsed.org
    if (parsed.project) updates.urlParsedProject = parsed.project
    if (parsed.repo) updates.urlParsedRepo = parsed.repo
    if (Object.keys(updates).length) {
      onChange({ ...updates, validated: false })
      setProjects([])
      setValidationError('')
    }
  }, [onChange])

  // ── destructure oauthHook for stable references in callbacks ───────────
  const { oauthStatus: oauthStatusValue, pausePolling, resumePolling } = oauthHook

  // ── credential mode switch ─────────────────────────────────────────────
  const handleModeSwitch = useCallback((newMode) => {
    if (newMode === source.credentialMode) return
    if (source.credentialMode === 'oauth' && newMode !== 'oauth') {
      pausePolling()
    }
    if (newMode === 'oauth' && source.credentialMode !== 'oauth') {
      if (oauthStatusValue === 'pending') resumePolling()
    }
    onChange({ credentialMode: newMode, validated: false })
    setProjects([])
    setValidationError('')
  }, [source.credentialMode, oauthStatusValue, pausePolling, resumePolling, onChange])

  // ── auto-validate ──────────────────────────────────────────────────────
  const credentialReady = (
    (source.credentialMode === 'serverPat' && envAuthAvailable) ||
    (source.credentialMode === 'personalPat' && source.pat?.trim()) ||
    (source.credentialMode === 'oauth' && oauthStatusValue === 'success')
  )

  const runValidation = useCallback(async () => {
    if (!source.org?.trim() || !credentialReady) return
    setValidating(true)
    setValidationError('')
    try {
      const body = {
        org: source.org,
        pat: source.credentialMode === 'personalPat' ? source.pat : undefined,
      }
      const [validateRes, projectsRes] = await Promise.all([
        fetch('/api/azure/validate', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        fetch('/api/azure/projects', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      ])
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
      // immediate — no debounce
      runValidation()
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(runValidation, DEBOUNCE_MS)
    return () => clearTimeout(debounceRef.current)
  }, [source.org, source.pat, source.credentialMode, oauthStatusValue, credentialReady, runValidation])

  // ── project dropdown change ────────────────────────────────────────────
  const handleProjectChange = (e) => onChange({ project: e.target.value })

  // ── parsed badge for smart paste ───────────────────────────────────────
  const parsedBadge = smartPasteValue ? parseAzureUrl(smartPasteValue) : null

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

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
            onChange={(e) => {
              setSmartPasteValue(e.target.value)
              handleUrlPaste(e.target.value)
            }}
            placeholder="https://dev.azure.com/org/project or org/project/repo"
            className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
          />
        </div>
        {parsedBadge && (() => {
          const parts = []
          if (parsedBadge.org) parts.push(`org: ${parsedBadge.org}`)
          if (parsedBadge.project) parts.push(`project: ${parsedBadge.project}`)
          if (parsedBadge.repo) parts.push(`repo: ${parsedBadge.repo}`)
          if (!parts.length && parsedBadge.error) {
            return <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{parsedBadge.error}</p>
          }
          if (!parts.length) return null
          return (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {parts.map((p) => (
                <span key={p} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                  {p}
                </span>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Manual Org */}
      <div>
        <label htmlFor="azure-org" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          Organization
        </label>
        <div className="relative">
          <Cloud className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="azure-org"
            type="text"
            value={source.org}
            onChange={(e) => {
              onChange({ org: e.target.value, validated: false, project: '' })
              setProjects([])
              setValidationError('')
            }}
            placeholder="my-organization"
            className="w-full pl-9 pr-10 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
          />
          {validating && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500 animate-spin" />
          )}
        </div>
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
            >
              {!oauthConfigured ? (
                <pre className="text-xs bg-slate-800 text-slate-300 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{`1. Register an app in Azure Portal (Azure Active Directory → App Registrations).\n2. Set Redirect URI to: http://localhost:3001/api/azure/oauth/callback\n3. Add to your server .env file:\n     AZURE_CLIENT_ID=<app-client-id>\n     AZURE_CLIENT_SECRET=<app-client-secret>\n     AZURE_TENANT_ID=<tenant-id>  (or "common" for multi-tenant)\n4. Restart the server.`}</pre>
              ) : source.credentialMode === 'oauth' ? (
                <div className="space-y-2">
                  {oauthHook.oauthStatus === 'idle' && (
                    <button
                      type="button"
                      onClick={() => {
                        const popup = window.open('/api/azure/oauth/start', '_blank')
                        if (!popup) {
                          setValidationError('Popup blocked — allow popups for this page and try again.')
                          return
                        }
                        oauthHook.startOAuth()
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
                    >
                      <Globe className="w-4 h-4" />
                      Open browser to authenticate
                    </button>
                  )}
                  {oauthHook.oauthStatus === 'pending' && (
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Waiting for browser authentication...
                    </div>
                  )}
                  {oauthHook.oauthStatus === 'success' && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      Authenticated
                    </span>
                  )}
                  {(oauthHook.oauthStatus === 'error' || oauthHook.oauthStatus === 'timeout') && (
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                      <XCircle className="w-4 h-4" />
                      {oauthHook.oauthStatus === 'timeout' ? 'Authentication timed out — ' : 'Authentication error — '}
                      <button type="button" onClick={oauthHook.retryOAuth} className="underline">try again</button>
                    </div>
                  )}
                </div>
              ) : null}
            </CredCard>

          </div>
        )}
      </div>

      {/* Validation status */}
      {source.validated && (
        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          Connected
        </span>
      )}
      {validationError && !validating && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <XCircle className="w-4 h-4 shrink-0" />
          {validationError}
          <button type="button" onClick={runValidation} className="underline ml-1">Retry</button>
        </div>
      )}

      {/* Project Dropdown */}
      {source.validated && (
        <div>
          <label htmlFor="azure-project" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Project
          </label>
          <div className="relative">
            <select
              id="azure-project"
              value={source.project}
              onChange={handleProjectChange}
              className="w-full appearance-none pl-3 pr-9 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
            >
              <option value="">Select a project...</option>
              {projects.map((p) => (
                <option key={p.id || p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>
      )}

    </div>
  )
}

// ── CredCard ──────────────────────────────────────────────────────────────
function CredCard({ mode, icon: Icon, label, subtitle, available, active, onSelect, children }) {
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
        </div>
        {active && selectable && <CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0" />}
      </div>
      {(!selectable || active) && children && (
        <div className="mt-3">{children}</div>
      )}
    </div>
  )
}
