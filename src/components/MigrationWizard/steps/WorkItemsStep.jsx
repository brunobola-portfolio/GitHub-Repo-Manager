import { useState, useEffect, useCallback } from 'react'
import {
  AlertCircle, ListChecks, MessageSquare,
  Paperclip, History, LayoutGrid, Tag,
} from 'lucide-react'
import { SectionSpinner } from '../../ui/Spinner'
import { Input, Switch } from '../../ui/form'
import { Badge } from '../../ui/Badge'
import { azurePost } from '../../../api/azure'

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
        const data = await azurePost('/azure/work-items/counts', source, {
          org: source.org,
          project: source.project,
        })
        if (data.counts) {
          setTypeCounts(data.counts)
          // Update wizard state with counts
          onUpdate({ counts: data.counts })
          // Auto-select all types
          if (workItems.types.length === 0) {
            onUpdate({ types: Object.keys(data.counts) })
          }
        } else {
          setError(data.error || "Couldn't load work item counts")
        }
      } catch (e) {
        setError(e.data?.error || e.message || 'Could not reach server')
      } finally {
        setLoading(false)
      }
    }

    fetchCounts()
  }, [workItems.enabled, typeCounts, source, workItems.types.length, onUpdate])

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
      {/* Master Toggle */}
      <div className="flex items-center justify-between">
        <div />
        <Switch
          checked={workItems.enabled}
          onChange={handleToggleEnabled}
          label="Migrate Work Items"
        />
      </div>

      {!workItems.enabled && (
        <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">
          <ListChecks className="w-8 h-8 mx-auto mb-2 opacity-50" />
          Enable to configure work item migration
        </div>
      )}

      {workItems.enabled && loading && (
        <SectionSpinner label="Loading work item counts..." />
      )}

      {workItems.enabled && error && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="p-3 rounded-full bg-rose-100 dark:bg-rose-900/30">
            <AlertCircle className="w-6 h-6 text-rose-500" />
          </div>
          <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{error}</p>
          <button
            type="button"
            onClick={() => {
              setTypeCounts(null)
              setError('')
            }}
            className="text-sm text-brand-500 hover:text-brand-400 underline transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {workItems.enabled && !loading && !error && typeCounts && (
        <>
          {/* Type Selection */}
          <div>
            <p className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Work Item Types
            </p>
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
                        ? 'border-brand-500/60 bg-brand-950/20'
                        : 'border-slate-200 dark:border-slate-700 hover:border-brand-400/50'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
                        isChecked
                          ? 'bg-brand-500 border-brand-500'
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
                    <Badge tone="neutral" size="sm" className="ml-auto">
                      {count}
                    </Badge>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Options */}
          <div>
            <p className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Options
            </p>
            <div className="space-y-2">
              {[
                { key: 'includeComments', label: 'Include Comments', icon: MessageSquare },
                { key: 'includeAttachments', label: 'Include Attachments', icon: Paperclip },
                { key: 'includeHistory', label: 'Include History', icon: History },
              ].map(({ key, label, icon: Icon }) => (
                <div
                  key={key}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-brand-400/50 transition-all text-sm"
                >
                  <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-slate-700 dark:text-slate-300">{label}</span>
                  <div className="ml-auto">
                    <Switch
                      size="sm"
                      checked={!!workItems[key]}
                      onChange={() => handleToggleOption(key)}
                      label={label}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Label Mapping */}
          <div>
            <p className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              <Tag className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Label Mapping
            </p>
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
                        <Input
                          type="text"
                          size="sm"
                          value={(workItems.labelMapping || {})[type] || ''}
                          onChange={(e) => handleLabelChange(type, e.target.value)}
                          aria-label={`GitHub label for ${type}`}
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
          <div className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-brand-400/50 transition-all text-sm">
            <LayoutGrid className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-slate-700 dark:text-slate-300">Create GitHub Project Board</span>
            <div className="ml-auto">
              <Switch
                size="sm"
                checked={!!workItems.createProjectBoard}
                onChange={handleToggleProjectBoard}
                label="Create GitHub Project Board"
              />
            </div>
          </div>

          {/* Preview */}
          {totalSelected > 0 && (
            <div className="p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 text-sm">
              <p className="text-brand-700 dark:text-brand-300">
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
