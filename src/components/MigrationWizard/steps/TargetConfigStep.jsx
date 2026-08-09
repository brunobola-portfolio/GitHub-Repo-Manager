import { useState, useEffect, useRef, useCallback } from 'react'
import {
  FolderGit2, Lock, Globe, Loader2, CheckCircle2, XCircle,
} from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import { Field, Input, Textarea } from '../../ui/form'
import { Select } from '../../ui/Select'
import { getCsrfToken } from '../../../utils/api'
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

  const nameTrailing = (
    <>
      {nameStatus === 'checking' && <Spinner size="md" tone="warning" />}
      {nameStatus === 'clear' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
      {nameStatus === 'conflict' && <XCircle className="w-4 h-4 text-red-500" />}
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
            ? 'text-white bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] hover:bg-[color:var(--ds-accent-brand-hover)] dark:hover:bg-[color:var(--ds-accent-brand)] shadow-md'
            : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed'}`}
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
