import { useState, useEffect, useCallback } from 'react'
import {
  Cloud, KeyRound, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  ExternalLink, ChevronDown,
} from 'lucide-react'

/**
 * SourceStep - Azure DevOps source selection for the Migration Wizard.
 *
 * Props:
 *   source   – { type, org, project, pat, validated }
 *   onChange  – (updates) => void  (calls wizard.updateSource)
 */
export default function SourceStep({ source, onChange }) {
  const [envAuthAvailable, setEnvAuthAvailable] = useState(null)
  const [useServerPat, setUseServerPat] = useState(false)
  const [showPat, setShowPat] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [projects, setProjects] = useState([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [projectsError, setProjectsError] = useState('')

  // Check if server has AZURE_PAT configured
  useEffect(() => {
    fetch('/api/azure/env-auth', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        setEnvAuthAvailable(data.available)
        if (data.available) setUseServerPat(true)
      })
      .catch(() => setEnvAuthAvailable(false))
  }, [])

  // Fetch projects when org + credentials are valid
  const fetchProjects = useCallback(async (org, pat) => {
    setLoadingProjects(true)
    setProjectsError('')
    try {
      const res = await fetch('/api/azure/projects', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org, pat: useServerPat ? undefined : pat }),
      })
      const data = await res.json()
      if (res.ok) {
        setProjects(data.projects || [])
      } else {
        setProjectsError(data.error || 'Failed to load projects')
        setProjects([])
      }
    } catch {
      setProjectsError('Could not reach server')
      setProjects([])
    } finally {
      setLoadingProjects(false)
    }
  }, [useServerPat])

  const handleValidate = async () => {
    setValidating(true)
    setValidationError('')

    try {
      const patPayload = useServerPat ? undefined : source.pat
      const res = await fetch('/api/azure/validate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org: source.org, pat: patPayload }),
      })
      const data = await res.json()

      if (data.valid) {
        onChange({ validated: true })
        fetchProjects(source.org, source.pat)
      } else {
        onChange({ validated: false })
        setValidationError(data.error || 'Invalid credentials')
      }
    } catch {
      onChange({ validated: false })
      setValidationError('Could not reach Azure DevOps. Check your connection.')
    } finally {
      setValidating(false)
    }
  }

  const handleOrgChange = (e) => {
    onChange({ org: e.target.value, validated: false, project: '' })
    setProjects([])
    setValidationError('')
  }

  const handlePatChange = (e) => {
    onChange({ pat: e.target.value, validated: false })
    setValidationError('')
  }

  const handleProjectChange = (e) => {
    onChange({ project: e.target.value })
  }

  const handleUseServerPatToggle = () => {
    const next = !useServerPat
    setUseServerPat(next)
    onChange({ validated: false })
    setValidationError('')
  }

  const canValidate =
    source.org.trim() !== '' && (useServerPat || source.pat.trim() !== '')

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Azure DevOps Source
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Connect to your Azure DevOps organization to select repositories for migration.
        </p>
      </div>

      {/* Organization */}
      <div>
        <label
          htmlFor="azure-org"
          className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Organization
        </label>
        <div className="relative">
          <Cloud className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="azure-org"
            type="text"
            value={source.org}
            onChange={handleOrgChange}
            placeholder="my-organization"
            className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
          />
        </div>
      </div>

      {/* Server PAT Toggle */}
      {envAuthAvailable !== null && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={useServerPat}
            aria-label="Use server PAT"
            onClick={handleUseServerPatToggle}
            disabled={!envAuthAvailable}
            className={`
              relative w-10 h-6 rounded-full transition-colors shrink-0
              ${useServerPat && envAuthAvailable
                ? 'bg-indigo-500'
                : 'bg-slate-300 dark:bg-slate-600'
              }
              ${!envAuthAvailable ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <span
              className={`
                absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
                ${useServerPat && envAuthAvailable ? 'translate-x-4' : 'translate-x-0'}
              `}
            />
          </button>
          <span className="text-sm text-slate-600 dark:text-slate-400">
            {envAuthAvailable
              ? 'Use server PAT'
              : 'No server PAT configured'}
          </span>
        </div>
      )}

      {/* PAT Input */}
      {(!useServerPat || !envAuthAvailable) && (
        <div>
          <label
            htmlFor="azure-pat"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Personal Access Token
          </label>
          <div className="relative">
            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="azure-pat"
              type={showPat ? 'text' : 'password'}
              value={source.pat}
              onChange={handlePatChange}
              placeholder="Paste your Personal Access Token"
              className="w-full pl-9 pr-10 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPat(!showPat)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              aria-label={showPat ? 'Hide PAT' : 'Show PAT'}
            >
              {showPat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex items-center justify-between mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>Scope: Code (Read)</span>
            {source.org && (
              <a
                href={`https://dev.azure.com/${encodeURIComponent(source.org)}/_usersSettings/tokens`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-500 hover:text-indigo-400 inline-flex items-center gap-1"
              >
                Create PAT <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Validate Button + Status */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleValidate}
          disabled={!canValidate || validating}
          className={`
            inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all
            ${canValidate && !validating
              ? 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
            }
          `}
        >
          {validating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Validating...
            </>
          ) : (
            'Validate'
          )}
        </button>

        {source.validated && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            Connected
          </span>
        )}

        {validationError && (
          <span className="inline-flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
            <XCircle className="w-4 h-4" />
            {validationError}
          </span>
        )}
      </div>

      {/* Project Dropdown */}
      {source.validated && (
        <div>
          <label
            htmlFor="azure-project"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Project
          </label>
          <div className="relative">
            {loadingProjects ? (
              <div className="flex items-center gap-2 py-2.5 px-3 text-sm text-slate-500 dark:text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading projects...
              </div>
            ) : (
              <>
                <select
                  id="azure-project"
                  value={source.project}
                  onChange={handleProjectChange}
                  className="w-full appearance-none pl-3 pr-9 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
                >
                  <option value="">Select a project...</option>
                  {projects.map((p) => (
                    <option key={p.id || p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </>
            )}
          </div>
          {projectsError && (
            <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">{projectsError}</p>
          )}
        </div>
      )}
    </div>
  )
}
