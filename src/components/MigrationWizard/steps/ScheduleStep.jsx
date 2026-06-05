import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Rocket, Calendar, Clock, Package, ClipboardList, BookOpen,
  AlertCircle, Loader2, Info, Flag, HardDrive, AlertTriangle,
} from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import { Field, Input } from '../../ui/form'
import { migrationApi } from '../../../api/migration'
import { useToast } from '../../../hooks/useToast'
import { StatCard } from '../ui/repo/StatCard'
import { formatFileSize } from '../../../utils/format'
import { TaggingPolicyPanel } from './TaggingPolicyPanel'
import { DEFAULT_TAGGING_POLICY } from './taggingDefaults'

function SummaryCard({ wizard }) {
  const selectedRepos = (wizard.repos || []).filter(r => r.selected)
  const workItemCount = wizard.workItems?.enabled
    ? Object.values(wizard.workItems.counts || {}).reduce((a, b) => a + b, 0)
    : 0
  const wikiCount = wizard.wiki?.enabled ? (wizard.wiki.wikis || []).length : 0
  const targetOrg = wizard.source?.targetOrg || wizard.source?.org || 'GitHub'
  const estimatedMinutes = wizard.aiPlan?.estimatedMinutes || null
  const totalSize = selectedRepos.reduce((s, r) => s + (r.size || 0), 0)
  const warnings = selectedRepos.reduce(
    (s, r) => s + (r.risk?.flags || []).filter((f) => f.severity === 'warning').length,
    0
  )

  return (
    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Migration Summary</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Package} label="Repositories" value={selectedRepos.length} tone="indigo" />
        <StatCard icon={HardDrive} label="Total size" value={formatFileSize(totalSize, 1)} tone="cyan" />
        {estimatedMinutes && <StatCard icon={Clock} label="Estimated" value={`~${estimatedMinutes}m`} tone="violet" />}
        <StatCard icon={Flag} label="Target" value={targetOrg} tone="emerald" />
        {workItemCount > 0 && <StatCard icon={ClipboardList} label="Work items" value={workItemCount} tone="amber" />}
        {wikiCount > 0 && <StatCard icon={BookOpen} label="Wiki pages" value={wikiCount} tone="emerald" />}
        {warnings > 0 && <StatCard icon={AlertTriangle} label="Warnings" value={warnings} tone="amber" />}
      </div>
    </div>
  )
}

export default function ScheduleStep({ schedule, onUpdate, wizard }) {
  const { toast } = useToast()
  const [executing, setExecuting] = useState(false)
  const [execError, setExecError] = useState(null)
  const [scheduled, setScheduled] = useState(false)

  // Minimum schedule time: now + 5 minutes
  const minDateTime = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const d = new Date(Date.now() + 5 * 60 * 1000)
    return d.toISOString().slice(0, 16) // YYYY-MM-DDTHH:MM format for datetime-local
  }, [])

  const handleExecute = async () => {
    setExecuting(true)
    setExecError(null)

    try {
      // Build tasks from wizard state
      const selectedRepos = (wizard.repos || []).filter(r => r.selected)
      const source = wizard.source || {}
      const targetOrg = source.targetOrg || ''
      // In-place mode = convert TFVC → Git inside an Azure DevOps / TFS
      // project on the same server (no GitHub push). The user picks the
      // destination project in RepoConfigStep (default: source.project).
      // Per-repo, they can also choose to reuse an existing empty repo
      // instead of creating a new one. Only meaningful for repo-tfvc tasks;
      // Git→Git in-place is a noop so we leave those tasks unchanged.
      const isInPlace = source.azureTargetMode === 'azure-devops'
      const targetProject = source.targetProject || source.project
      const tasks = selectedRepos
        .filter((repo) => repo.sizeStrategy !== 'exclude')
        .map(repo => {
          const repoName = repo.targetName || repo.name
          const baseConfig = {
            makePrivate: repo.visibility === 'private',
            description: repo.description || '',
          }
          let config = repo.sizeStrategy === 'lfs-migrate'
            ? { ...baseConfig, sizeStrategy: 'lfs-migrate' }
            : baseConfig
          if (isInPlace && repo.isTfvc) {
            config = {
              ...config,
              inPlace: true,
              targetProject,
              ...(repo.targetType === 'existing-empty' && repo.existingRepoId
                ? { existingRepoId: repo.existingRepoId }
                : {}),
            }
          }
          // targetRef must be 2 parts ("owner/repoName") because the engine's
          // validation regex rejects slashes in the repo segment. For in-place,
          // we encode owner=source.org and pass the destination project via
          // config.targetProject (the engine reads both).
          const targetRef = isInPlace && repo.isTfvc
            ? `${source.org}/${repoName}`
            : (targetOrg ? `${targetOrg}/${repoName}` : repoName)
          return {
            type: repo.isTfvc ? 'repo-tfvc' : 'repo',
            sourceRef: `${source.org}/${source.project}/${repo.name}`,
            targetRef,
            config,
          }
        })

      // Add work item tasks — target the first migrated repo for issues
      if (wizard.workItems?.enabled) {
        const firstRepo = selectedRepos[0]
        const firstRepoTarget = firstRepo?.targetName || firstRepo?.name || 'issues'
        tasks.push({
          type: 'work-items',
          sourceRef: `${source.org}/${source.project}`,
          targetRef: targetOrg ? `${targetOrg}/${firstRepoTarget}` : firstRepoTarget,
          config: { types: wizard.workItems.types },
        })
      }

      // Add wiki tasks
      if (wizard.wiki?.enabled) {
        for (const w of wizard.wiki.wikis || []) {
          const destination = wizard.wiki.destinations?.[w.id] || 'wiki'
          tasks.push({
            type: 'wiki',
            sourceRef: w.name || w.id,
            targetRef: destination,
            config: { destination },
          })
        }
      }

      const planData = {
        source: {
          type: wizard.source?.type || 'azure',
          // Forward the resolved host so the backend validates against the
          // actual server the wizard used (e.g. tfs.company.com), not zod's
          // 'dev.azure.com' default which fails when the allowlist doesn't
          // include cloud Azure.
          ...(wizard.source?.host ? { host: wizard.source.host } : {}),
          org: wizard.source?.org,
          project: wizard.source?.project,
          ...(wizard.source?.pat ? { pat: wizard.source.pat } : {}),
        },
        tasks,
        targetOrg: targetOrg,
        schedule: {
          mode: schedule.mode || 'now',
          isDryRun: !!schedule.isDryRun,
          ...(schedule.mode === 'scheduled' && schedule.scheduledAt
            ? { scheduledAt: new Date(schedule.scheduledAt).toISOString() }
            : {}),
        },
        ...(wizard.taggingPolicy ? { taggingPolicy: wizard.taggingPolicy } : {}),
      }

      const { planId } = await migrationApi.createPlan(planData)

      if (schedule.mode === 'scheduled') {
        // For scheduled migrations, show success inline
        if (wizard.setPlanId) wizard.setPlanId(planId)
        setScheduled(true)
        toast.success('Migration scheduled')
      } else {
        // Execute immediately and go to progress. Forward either the pasted
        // PAT or the savedCredentialId so the backend can decrypt it from
        // the per-user vault — without one of the two, TFVC migrations fail
        // with 401 Unauthorized against the on-prem TFS host.
        await migrationApi.executePlan(planId, {
          azurePat: wizard.source?.pat || null,
          savedCredentialId: wizard.source?.savedCredentialId || null,
        })
        if (wizard.setPlanId) wizard.setPlanId(planId)
        if (wizard.nextStep) wizard.nextStep()
        toast.success('Migration queued')
      }
    } catch (err) {
      console.error('[ScheduleStep] Migration error:', err)
      setExecError(err.message || 'Failed to start migration')
      toast.errorFromException(err, { fallbackTitle: 'Failed to start migration' })
    } finally {
      setExecuting(false)
    }
  }

  const buttonLabel = schedule.mode === 'now'
    ? (schedule.isDryRun ? 'Start Dry Run' : 'Start Migration')
    : (schedule.isDryRun ? 'Schedule Dry Run' : 'Schedule Migration')

  return (
    <div className="space-y-5">
      {/* Summary card */}
      <SummaryCard wizard={wizard} />

      {/* Execute mode radio */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Execution Timing
        </legend>

        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className={`
          flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all
          ${schedule.mode === 'now'
            ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-500/20'
            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
          }
        `}>
          <input
            type="radio"
            name="schedule-mode"
            value="now"
            checked={schedule.mode === 'now'}
            onChange={() => onUpdate({ mode: 'now', scheduledAt: null })}
            className="text-indigo-500 focus:ring-indigo-500"
          />
          <div>
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Rocket className="w-4 h-4 text-indigo-500" />
              Execute Now
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Start the migration immediately after confirmation
            </p>
          </div>
        </label>

        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className={`
          flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all
          ${schedule.mode === 'scheduled'
            ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-500/20'
            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
          }
        `}>
          <input
            type="radio"
            name="schedule-mode"
            value="scheduled"
            checked={schedule.mode === 'scheduled'}
            onChange={() => onUpdate({ mode: 'scheduled' })}
            className="text-indigo-500 focus:ring-indigo-500"
          />
          <div>
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-500" />
              Schedule for Later
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Set a future date and time for the migration
            </p>
          </div>
        </label>
      </fieldset>

      {/* DateTime input for scheduled mode */}
      {schedule.mode === 'scheduled' && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <Field label="Scheduled Date & Time" htmlFor="schedule-datetime">
            <Input
              id="schedule-datetime"
              type="datetime-local"
              min={minDateTime}
              value={schedule.scheduledAt || ''}
              onChange={(e) => onUpdate({ scheduledAt: e.target.value })}
            />
          </Field>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Info className="w-3 h-3" />
            Credentials will be securely stored until execution time.
          </p>
        </motion.div>
      )}

      {/* Dry-run checkbox */}
      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={schedule.isDryRun}
          onChange={(e) => onUpdate({ isDryRun: e.target.checked })}
          className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-500 focus:ring-indigo-500"
        />
        <div>
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Dry Run</span>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Simulate the migration without making any changes
          </p>
        </div>
      </label>

      {/* Tagging policy */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white/30 dark:bg-slate-800/30">
        <TaggingPolicyPanel
          policy={wizard.taggingPolicy || DEFAULT_TAGGING_POLICY}
          onChange={(p) => wizard.updateTaggingPolicy?.(p)}
        />
      </div>

      {/* Error */}
      {execError && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{execError}</span>
        </div>
      )}

      {/* Scheduled success message */}
      {scheduled && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm">
          <Calendar className="w-4 h-4 shrink-0" />
          <span>Migration scheduled for {schedule.scheduledAt ? new Date(schedule.scheduledAt).toLocaleString() : 'later'}. You can close this wizard.</span>
        </div>
      )}

      {/* Execute button */}
      {!scheduled && (
        <button
          type="button"
          onClick={handleExecute}
          disabled={executing || (schedule.mode === 'scheduled' && !schedule.scheduledAt)}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium rounded-xl
            text-white
            bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)]
            hover:bg-[color:var(--ds-accent-brand-hover)] dark:hover:bg-indigo-600
            shadow-md
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all"
        >
          {executing ? (
            <>
              <Spinner size="md" tone="onPrimary" />
              {schedule.mode === 'now' ? 'Starting...' : 'Scheduling...'}
            </>
          ) : (
            <>
              <Rocket className="w-4 h-4" />
              {buttonLabel}
            </>
          )}
        </button>
      )}
    </div>
  )
}
