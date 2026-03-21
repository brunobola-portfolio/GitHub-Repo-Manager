import { useState, useEffect, useCallback } from 'react'
import {
  Loader2, AlertCircle, ListChecks, MessageSquare,
  Paperclip, History, LayoutGrid, Tag,
} from 'lucide-react'

const DEFAULT_LABEL_MAPPING = {
  Bug: 'bug',
  'User Story': 'user-story',
  Task: 'task',
  Epic: 'epic',
  Feature: 'feature',
  Issue: 'issue',
  'Test Case': 'test-case',
}

/**
 * WorkItemsStep - Configure work item migration for the Migration Wizard.
 *
 * Props:
 *   workItems - { enabled, types, includeComments, includeAttachments, includeHistory, labelMapping, createProjectBoard }
 *   onUpdate  - (updates) => void
 *   source    - { org, project, pat }
 */
export default function WorkItemsStep({ workItems, onUpdate, source }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [typeCounts, setTypeCounts] = useState(null) // { Bug: 5, 'User Story': 12, ... }

  // Initialize label mapping if not set
  useEffect(() => {
    if (workItems.enabled && !workItems.labelMapping) {
      onUpdate({ labelMapping: { ...DEFAULT_LABEL_MAPPING } })
    }
  }, [workItems.enabled, workItems.labelMapping, onUpdate])

  // Fetch type counts when enabled
  useEffect(() => {
    if (!workItems.enabled || typeCounts !== null) return

    const fetchCounts = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/azure/work-items/counts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org: source.org,
            project: source.project,
            pat: source.pat || undefined,
          }),
        })
        const data = await res.json()
        if (res.ok && data.counts) {
          setTypeCounts(data.counts)
          // Auto-select all types
          if (workItems.types.length === 0) {
            onUpdate({ types: Object.keys(data.counts) })
          }
        } else {
          setError(data.error || 'Failed to load work item counts')
        }
      } catch {
        setError('Could not reach server')
      } finally {
        setLoading(false)
      }
    }

    fetchCounts()
  }, [workItems.enabled, typeCounts, source.org, source.project, source.pat, workItems.types.length, onUpdate])

  const handleToggleEnabled = useCallback(() => {
    const next = !workItems.enabled
    onUpdate({
      enabled: next,
      ...(next && !workItems.labelMapping ? { labelMapping: { ...DEFAULT_LABEL_MAPPING } } : {}),
    })
    if (!next) {
      setTypeCounts(null)
    }
  }, [workItems.enabled, workItems.labelMapping, onUpdate])

  const handleToggleType = useCallback((type) => {
    const current = workItems.types || []
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type]
    onUpdate({ types: next })
  }, [workItems.types, onUpdate])

  const handleToggleOption = useCallback((key) => {
    onUpdate({ [key]: !workItems[key] })
  }, [workItems, onUpdate])

  const handleLabelChange = useCallback((type, label) => {
    onUpdate({
      labelMapping: {
        ...(workItems.labelMapping || {}),
        [type]: label,
      },
    })
  }, [workItems.labelMapping, onUpdate])

  const handleToggleProjectBoard = useCallback(() => {
    onUpdate({ createProjectBoard: !workItems.createProjectBoard })
  }, [workItems.createProjectBoard, onUpdate])

  // Calculate total selected work items
  const totalSelected = typeCounts
    ? (workItems.types || []).reduce((sum, type) => sum + (typeCounts[type] || 0), 0)
    : 0

  return (
    <div className="space-y-5">
      {/* Header + Master Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Work Items
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Migrate Azure DevOps work items as GitHub Issues
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={workItems.enabled}
          aria-label="Migrate Work Items"
          onClick={handleToggleEnabled}
          className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${
            workItems.enabled
              ? 'bg-indigo-500'
              : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
              workItems.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {!workItems.enabled && (
        <div className="text-center py-8 text-sm text-slate-400 dark:text-slate-500">
          <ListChecks className="w-8 h-8 mx-auto mb-2 opacity-50" />
          Enable to configure work item migration
        </div>
      )}

      {workItems.enabled && loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading work item counts...
          </p>
        </div>
      )}

      {workItems.enabled && error && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => {
              setTypeCounts(null)
              setError('')
            }}
            className="text-sm text-indigo-500 hover:text-indigo-400 underline transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {workItems.enabled && !loading && !error && typeCounts && (
        <>
          {/* Type Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Work Item Types
            </label>
            <div className="space-y-1.5">
              {Object.entries(typeCounts).map(([type, count]) => {
                const isChecked = (workItems.types || []).includes(type)
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleToggleType(type)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-sm transition-all ${
                      isChecked
                        ? 'border-indigo-500/60 bg-indigo-950/20'
                        : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400/50'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
                        isChecked
                          ? 'bg-indigo-500 border-indigo-500'
                          : 'border-slate-400 dark:border-slate-600'
                      }`}
                    >
                      {isChecked && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="font-medium text-slate-900 dark:text-slate-100">{type}</span>
                    <span className="ml-auto px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Options */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Options
            </label>
            <div className="space-y-2">
              {[
                { key: 'includeComments', label: 'Include Comments', icon: MessageSquare },
                { key: 'includeAttachments', label: 'Include Attachments', icon: Paperclip },
                { key: 'includeHistory', label: 'Include History', icon: History },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleToggleOption(key)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400/50 transition-all text-sm"
                >
                  <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-slate-700 dark:text-slate-300">{label}</span>
                  <div className="ml-auto">
                    <div
                      role="switch"
                      aria-checked={!!workItems[key]}
                      aria-label={label}
                      className={`relative w-9 h-5 rounded-full transition-colors ${
                        workItems[key]
                          ? 'bg-indigo-500'
                          : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          workItems[key] ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Label Mapping */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              <Tag className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Label Mapping
            </label>
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50">
                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      ADO Type
                    </th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      GitHub Label
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {(workItems.types || []).map((type) => (
                    <tr key={type}>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-medium">
                        {type}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={(workItems.labelMapping || {})[type] || ''}
                          onChange={(e) => handleLabelChange(type, e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                          placeholder={type.toLowerCase().replace(/\s+/g, '-')}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Create Project Board */}
          <button
            type="button"
            onClick={handleToggleProjectBoard}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400/50 transition-all text-sm"
          >
            <LayoutGrid className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-slate-700 dark:text-slate-300">Create GitHub Project Board</span>
            <div className="ml-auto">
              <div
                role="switch"
                aria-checked={!!workItems.createProjectBoard}
                aria-label="Create GitHub Project Board"
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  workItems.createProjectBoard
                    ? 'bg-indigo-500'
                    : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    workItems.createProjectBoard ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </div>
            </div>
          </button>

          {/* Preview */}
          {totalSelected > 0 && (
            <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 text-sm">
              <p className="text-indigo-700 dark:text-indigo-300">
                <span className="font-semibold">{totalSelected}</span> work item{totalSelected !== 1 ? 's' : ''} will
                be migrated as{' '}
                <span className="font-semibold">{totalSelected}</span> GitHub Issue{totalSelected !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
