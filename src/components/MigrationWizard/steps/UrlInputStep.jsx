import { useState } from 'react'
import {
  Link2, KeyRound, User, Lock, Loader2, CheckCircle2, XCircle,
  Info, ArrowRight,
} from 'lucide-react'
import { parseAzureUrl } from '../../../utils/azureUrlParser'

/**
 * UrlInputStep - Git URL entry + authentication for the unified Migration Wizard.
 *
 * Props:
 *   source   – { sourceUrl, urlValidation, urlError, authType, authToken, authUsername, authPassword, targetName }
 *   onChange  – (updates) => void
 */
export default function UrlInputStep({ source, onChange }) {
  const [azureDetected, setAzureDetected] = useState(false)

  const handleUrlChange = (e) => {
    const url = e.target.value
    const parsed = parseAzureUrl(url)
    setAzureDetected(!!(parsed.org && !parsed.error))
    onChange({ sourceUrl: url, urlValidation: null, urlError: '' })
  }

  const buildCredentials = () => {
    if (source.authType === 'token') return { type: 'token', token: source.authToken }
    if (source.authType === 'basic') return { type: 'basic', username: source.authUsername, password: source.authPassword }
    return undefined
  }

  const handleValidate = async () => {
    onChange({ urlValidation: 'validating', urlError: '' })
    try {
      const res = await fetch('/api/import/validate-url', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: source.sourceUrl, credentials: buildCredentials() }),
      })
      const data = await res.json()
      if (data.valid) {
        const autoName = source.sourceUrl.replace(/\.git$/, '').split('/').pop() || ''
        onChange({ urlValidation: 'valid', targetName: autoName })
      } else {
        onChange({ urlValidation: 'invalid', urlError: data.error || 'Cannot access repository' })
      }
    } catch (e) {
      onChange({ urlValidation: 'invalid', urlError: e.message })
    }
  }

  const authOptions = [
    { value: 'none', label: 'None (Public)' },
    { value: 'token', label: 'Token / PAT' },
    { value: 'basic', label: 'Username / Password' },
  ]

  const canValidate =
    source.sourceUrl.trim() !== '' && source.urlValidation !== 'validating'

  return (
    <div className="space-y-5">
      {/* URL input */}
      <div>
        <label
          htmlFor="source-url"
          className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Clone URL
        </label>
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="source-url"
            type="url"
            value={source.sourceUrl}
            onChange={handleUrlChange}
            placeholder="https://github.com/user/repo.git"
            className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
          />
        </div>
      </div>

      {/* Azure URL auto-detection banner */}
      {azureDetected && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50">
          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-blue-700 dark:text-blue-300">
            This looks like an Azure DevOps URL. Switch to Azure DevOps import for full features
            (work items, wiki, AI review).
          </div>
          <button
            type="button"
            onClick={() => onChange({ sourceType: 'azure' })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-100 dark:bg-blue-800/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/60 transition-colors shrink-0"
          >
            Switch <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Auth type selector */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          Authentication
        </label>
        <div className="flex gap-2">
          {authOptions.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => onChange({ authType: a.value })}
              className={`flex-1 py-2 px-3 text-xs font-medium rounded-xl border transition-colors
                ${source.authType === a.value
                  ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Conditional auth fields */}
      {source.authType === 'token' && (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Access Token
          </label>
          <div className="relative">
            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="password"
              value={source.authToken}
              onChange={(e) => onChange({ authToken: e.target.value })}
              placeholder="ghp_... or PAT"
              className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
            />
          </div>
        </div>
      )}

      {source.authType === 'basic' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Username
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={source.authUsername}
                onChange={(e) => onChange({ authUsername: e.target.value })}
                placeholder="Username"
                className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                value={source.authPassword}
                onChange={(e) => onChange({ authPassword: e.target.value })}
                placeholder="Password"
                className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
              />
            </div>
          </div>
        </div>
      )}

      {/* Validate button + status */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleValidate}
          disabled={!canValidate}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all
            ${canValidate
              ? 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
            }`}
        >
          {source.urlValidation === 'validating' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Validating...
            </>
          ) : (
            'Validate URL'
          )}
        </button>

        {source.urlValidation === 'valid' && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            Repository accessible
          </span>
        )}

        {source.urlValidation === 'invalid' && (
          <span className="inline-flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
            <XCircle className="w-4 h-4" />
            {source.urlError}
          </span>
        )}
      </div>
    </div>
  )
}
