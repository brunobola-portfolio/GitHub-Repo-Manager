import { useState, useEffect, useRef, useCallback } from 'react'
import {
  FolderGit2, Lock, Globe, Loader2, CheckCircle2, XCircle, ChevronDown,
} from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import { getCsrfToken } from '../../../utils/api'

/**
 * TargetConfigStep - Configure the target GitHub repository for URL / GitHub imports.
 *
 * Props:
 *   source           - wizard source state (targetOrg, targetName, makePrivate, description, ...)
 *   onChange          - (updates) => void
 *   orgs             - array of GitHub organizations ({ login, ... })
 *   importJobs       - current import jobs array
 *   onUpdateImportJobs - setter for import jobs
 *   onStartImport    - callback to trigger the import
 */
export default function TargetConfigStep({ source, onChange, orgs, importJobs: _importJobs, onUpdateImportJobs: _onUpdateImportJobs, onStartImport }) {
  const [nameStatus, setNameStatus] = useState('idle') // idle | checking | clear | conflict
  const debounceRef = useRef(null)

  const checkDuplicate = useCallback(
    (name) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)

      if (!name?.trim()) {
        setNameStatus('idle')
        return
      }

      setNameStatus('checking')

      debounceRef.current = setTimeout(async () => {
        try {
          const csrfToken = await getCsrfToken().catch(() => null)
          const res = await fetch('/api/import/check-duplicates', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
            },
            body: JSON.stringify({ repos: [name], targetOwner: source.targetOrg || '' }),
          })
          const data = await res.json()
          if (res.ok && data.duplicates) {
            setNameStatus(data.duplicates[name] ? 'conflict' : 'clear')
          } else {
            setNameStatus('idle')
          }
        } catch {
          setNameStatus('idle')
        }
      }, 500)
    },
    [source.targetOrg]
  )

  // Re-check when org changes
  useEffect(() => {
    if (source.targetName?.trim()) {
      Promise.resolve().then(() => checkDuplicate(source.targetName))
    }
  }, [source.targetOrg, source.targetName, checkDuplicate])

  // Cleanup timer
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const handleNameChange = (e) => {
    const value = e.target.value
    onChange({ targetName: value })
    checkDuplicate(value)
  }

  return (
    <div className="space-y-5">
      {/* Owner dropdown */}
      <div>
        <label htmlFor="target-config-owner" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          Owner
        </label>
        <div className="relative">
          <select
            id="target-config-owner"
            value={source.targetOrg || ''}
            onChange={(e) => onChange({ targetOrg: e.target.value })}
            className="w-full appearance-none px-3 py-2.5 pr-9 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
          >
            <option value="">Personal Account</option>
            {orgs.map((org) => (
              <option key={org.login} value={org.login}>{org.login}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Repository name */}
      <div>
        <label htmlFor="target-config-repo-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          Repository name
        </label>
        <div className="relative">
          <FolderGit2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="target-config-repo-name"
            type="text"
            value={source.targetName || ''}
            onChange={handleNameChange}
            placeholder="my-repository"
            className={`w-full pl-9 pr-9 py-2.5 border rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors
              ${nameStatus === 'conflict' ? 'border-red-400 dark:border-red-600' : 'border-slate-300 dark:border-slate-600'}`}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {nameStatus === 'checking' && <Spinner size="md" tone="warning" />}
            {nameStatus === 'clear' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            {nameStatus === 'conflict' && <XCircle className="w-4 h-4 text-red-500" />}
          </div>
        </div>
        {nameStatus === 'conflict' && (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
            A repository with this name already exists.
          </p>
        )}
      </div>

      {/* Visibility toggle */}
      <div>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          Visibility
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange({ makePrivate: true })}
            className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3 text-sm font-medium rounded-xl border transition-colors
              ${source.makePrivate
                ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
          >
            <Lock className="w-4 h-4" />
            Private
          </button>
          <button
            type="button"
            onClick={() => onChange({ makePrivate: false })}
            className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3 text-sm font-medium rounded-xl border transition-colors
              ${!source.makePrivate
                ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
          >
            <Globe className="w-4 h-4" />
            Public
          </button>
        </div>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="target-config-description" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          Description (optional)
        </label>
        <textarea
          id="target-config-description"
          value={source.description || ''}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Repository description..."
          rows={2}
          className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors resize-none"
        />
      </div>

      {/* Import button */}
      <button
        type="button"
        onClick={onStartImport}
        disabled={!source.targetName?.trim()}
        className={`w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl transition-all
          ${source.targetName?.trim()
            ? 'text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/25'
            : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'}`}
      >
        Import Repository
      </button>
    </div>
  )
}
