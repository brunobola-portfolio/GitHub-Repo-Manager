import { useState, useEffect, useRef, useCallback } from 'react'
import {
  FolderGit2, Lock, Globe, Loader2, CheckCircle2, XCircle,
} from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import { Field, Input, Textarea } from '../../ui/form'
import { Select } from '../../ui/Select'
import { apiCall } from '../../../utils/api'
import { API_BASE } from '../../../config'
import AzureTargetForm from './TargetConfigStep/AzureTargetForm'

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
          // maxRetries: 0 — debounced on every keystroke; a retryable 5xx should
          // fall back to 'idle' fast rather than stall behind a backoff.
          const data = await apiCall(`${API_BASE}/import/check-duplicates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repos: [name], targetOwner: source.targetOrg || '' }),
          }, { maxRetries: 0 })
          setNameStatus(data.duplicates ? (data.duplicates[name] ? 'conflict' : 'clear') : 'idle')
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

  const nameTrailing = (
    <>
      {nameStatus === 'checking' && <Spinner size="md" tone="warning" />}
      {nameStatus === 'clear' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
      {nameStatus === 'conflict' && <XCircle className="w-4 h-4 text-rose-500" />}
    </>
  )

  // Azure source detected (host present) → show 4-mode target picker.
  // The 'github' sub-mode falls through to the existing GitHub form below.
  const isAzureSource = !!source.host && source.host !== 'github.com'
  const azureMode = source.azureTargetMode || 'github'

  const githubForm = (
    <div className="space-y-5">
      {/* Owner dropdown */}
      <div>
        <label htmlFor="target-config-owner" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          Owner
        </label>
        <Select
          label="Owner"
          value={source.targetOrg || ''}
          onChange={(v) => onChange({ targetOrg: v })}
          options={[
            { value: '', label: 'Personal Account' },
            ...orgs.map((org) => ({ value: org.login, label: org.login })),
          ]}
        />
      </div>

      {/* Repository name */}
      <Field
        label="Repository name"
        htmlFor="target-config-repo-name"
        error={nameStatus === 'conflict' ? 'A repository with this name already exists.' : undefined}
      >
        <Input
          id="target-config-repo-name"
          type="text"
          value={source.targetName || ''}
          onChange={handleNameChange}
          placeholder="my-repository"
          leadingIcon={FolderGit2}
          trailing={nameTrailing}
        />
      </Field>

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
                ? 'border-brand-400 dark:border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'} ds-focus-ring`}
          >
            <Lock className="w-4 h-4" />
            Private
          </button>
          <button
            type="button"
            onClick={() => onChange({ makePrivate: false })}
            className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3 text-sm font-medium rounded-xl border transition-colors
              ${!source.makePrivate
                ? 'border-brand-400 dark:border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'} ds-focus-ring`}
          >
            <Globe className="w-4 h-4" />
            Public
          </button>
        </div>
      </div>

      {/* Description */}
      <Field label="Description (optional)" htmlFor="target-config-description">
        <Textarea
          id="target-config-description"
          value={source.description || ''}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Repository description..."
          rows={2}
        />
      </Field>

      {/* Import button */}
      <button
        type="button"
        onClick={onStartImport}
        disabled={!source.targetName?.trim()}
        className={`w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl transition-all
          ${source.targetName?.trim()
            ? 'ds-brand-solid dark:hover:bg-[color:var(--ds-accent-brand)] ds-elevation-md'
            : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed'} ds-focus-ring`}
      >
        Import Repository
      </button>
    </div>
  )

  if (isAzureSource) {
    return (
      <AzureTargetForm
        source={source}
        onChange={onChange}
        githubTargetForm={azureMode === 'github' ? githubForm : null}
      />
    )
  }
  return githubForm
}
