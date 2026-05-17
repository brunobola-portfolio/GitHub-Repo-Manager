import { useState } from 'react'
import {
  Link2, KeyRound, User, Lock, Loader2, CheckCircle2, XCircle,
  Info, ArrowRight,
} from 'lucide-react'
import { parseAzureUrl } from '../../../utils/azureUrlParser'
import { Button } from '../../ui/Button'
import { Field, Input } from '../../ui/form'
import { getCsrfToken } from '../../../utils/api'

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
      const csrfToken = await getCsrfToken().catch(() => null)
      const res = await fetch('/api/import/validate-url', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
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
      <Field label="Clone URL" htmlFor="source-url">
        <Input
          id="source-url"
          type="url"
          value={source.sourceUrl}
          onChange={handleUrlChange}
          placeholder="https://github.com/user/repo.git"
          leadingIcon={Link2}
        />
      </Field>

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
        <p className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          Authentication
        </p>
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
        <Field label="Access Token" htmlFor="url-auth-token">
          <Input
            id="url-auth-token"
            type="password"
            value={source.authToken}
            onChange={(e) => onChange({ authToken: e.target.value })}
            placeholder="ghp_... or PAT"
            leadingIcon={KeyRound}
          />
        </Field>
      )}

      {source.authType === 'basic' && (
        <div className="space-y-3">
          <Field label="Username" htmlFor="url-auth-username">
            <Input
              id="url-auth-username"
              type="text"
              value={source.authUsername}
              onChange={(e) => onChange({ authUsername: e.target.value })}
              placeholder="Username"
              leadingIcon={User}
            />
          </Field>
          <Field label="Password" htmlFor="url-auth-password">
            <Input
              id="url-auth-password"
              type="password"
              value={source.authPassword}
              onChange={(e) => onChange({ authPassword: e.target.value })}
              placeholder="Password"
              leadingIcon={Lock}
            />
          </Field>
        </div>
      )}

      {/* Validate button + status */}
      <div className="flex items-center gap-3">
        <Button variant="primary" type="button" onClick={handleValidate} disabled={!canValidate}>
          {source.urlValidation === 'validating' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Validating...
            </>
          ) : (
            'Validate URL'
          )}
        </Button>

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
