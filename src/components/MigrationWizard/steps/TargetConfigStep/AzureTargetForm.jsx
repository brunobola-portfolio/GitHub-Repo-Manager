import { useEffect, useState } from 'react'
import { Cloud, FolderGit2, FolderPlus, Plus } from 'lucide-react'
import { Field, Input, Textarea } from '../../../ui/form'
import { Spinner } from '../../../ui/Spinner'
import { formatUserError } from '../../../../utils/errors'
import { Select } from '../../../ui/Select'
import { azurePost } from '../../../../api/azure'

/**
 * Azure target picker — 4 modes for Azure DevOps source migrations:
 *  - same-project: create a new Git repo in the SAME Azure project as the source
 *  - existing-project: create a new Git repo in another Azure project on the same org
 *  - new-project: create a new Azure DevOps project AND a Git repo inside it
 *  - github: push to GitHub (the legacy flow handled elsewhere)
 *
 * For now, the "same-project" / "existing-project" / "new-project" modes
 * record the user intent in `source.azureTarget`; the wizard step that
 * executes the migration is responsible for routing to either:
 *   POST /api/import/azure-tfvc          (when target = github)
 *   POST /api/azure/projects/create      (when target = new-project)
 *   …Azure-to-Azure pipeline             (when target = same-project / existing-project, TBD)
 */
export default function AzureTargetForm({ source, onChange, githubTargetForm = null }) {
  const mode = source.azureTargetMode || 'github'
  const setMode = (m) => onChange({ azureTargetMode: m })

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Migration target
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ModeCard
            active={mode === 'github'}
            onClick={() => setMode('github')}
            icon={Cloud}
            title="GitHub"
            desc="Creates a new repo on GitHub (main flow)."
          />
          <ModeCard
            active={mode === 'same-project'}
            onClick={() => setMode('same-project')}
            icon={FolderGit2}
            title="Same Azure project"
            desc="Creates a Git repo in the same project as the TFVC source."
          />
          <ModeCard
            active={mode === 'existing-project'}
            onClick={() => setMode('existing-project')}
            icon={FolderGit2}
            title="Another Azure project"
            desc="Creates the repo in an existing Azure project in the same organization."
          />
          <ModeCard
            active={mode === 'new-project'}
            onClick={() => setMode('new-project')}
            icon={FolderPlus}
            title="New Azure project"
            desc="Provisions a new Azure DevOps project and creates the repo there."
          />
        </div>
      </fieldset>

      {mode === 'github' && githubTargetForm}
      {mode === 'same-project' && <SameProjectForm source={source} onChange={onChange} />}
      {mode === 'existing-project' && <ExistingProjectForm source={source} onChange={onChange} />}
      {mode === 'new-project' && <NewProjectForm source={source} onChange={onChange} />}
    </div>
  )
}

function ModeCard({ active, onClick, icon: Icon, title, desc }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-xl border transition-colors
        ${active
          ? 'border-brand-400 dark:border-brand-500 bg-brand-50 dark:bg-brand-900/20'
          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${active ? 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]' : 'text-slate-500'}`} />
        <span className={`text-sm font-medium ${active ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-300'}`}>
          {title}
        </span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{desc}</p>
    </button>
  )
}

function SameProjectForm({ source, onChange }) {
  return (
    <div className="space-y-3 pt-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        The repo will be created in the same project as the source ({source.project || '—'}).
      </p>
      <Field label="Target repo name" htmlFor="azure-tgt-same-name">
        <Input
          id="azure-tgt-same-name"
          value={source.azureTargetRepoName || ''}
          onChange={(e) => onChange({ azureTargetRepoName: e.target.value })}
          placeholder="my-new-repo"
          leadingIcon={FolderGit2}
        />
      </Field>
    </div>
  )
}

function ExistingProjectForm({ source, onChange }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!source.org || !source.host) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const data = await azurePost('/azure/projects', source, { org: source.org })
        if (cancelled) return
        setProjects(data.projects || [])
      } catch (e) {
        if (!cancelled) setError(formatUserError(e, { fallbackTitle: 'Failed to list projects' }))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately scoped to the fields azureCredPayload(source) actually reads, not the whole `source` object (which also carries unrelated wizard state that must not re-trigger this fetch).
  }, [source.host, source.org, source.pat, source.credentialMode, source.savedCredentialId])

  return (
    <div className="space-y-3 pt-2">
      <Field label="Target Azure DevOps project" htmlFor="azure-tgt-existing-project">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner size="md" tone="muted" /> Loading projects…</div>
        ) : (
          <Select
            label="Target Azure DevOps project"
            placeholder="— choose a project —"
            value={source.azureTargetProject || ''}
            onChange={(v) => onChange({ azureTargetProject: v })}
            options={[
              { value: '', label: '— choose a project —' },
              ...projects.map((p) => ({ value: p.name, label: p.name })),
            ]}
          />
        )}
        {error && <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{error.title}</p>}
      </Field>
      <Field label="Target repo name" htmlFor="azure-tgt-existing-name">
        <Input
          id="azure-tgt-existing-name"
          value={source.azureTargetRepoName || ''}
          onChange={(e) => onChange({ azureTargetRepoName: e.target.value })}
          placeholder="my-new-repo"
          leadingIcon={FolderGit2}
        />
      </Field>
    </div>
  )
}

function NewProjectForm({ source, onChange }) {
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const createProject = async () => {
    setCreating(true); setError(null); setResult(null)
    try {
      const data = await azurePost('/azure/projects/create', source, {
        org: source.org,
        name: source.azureNewProjectName,
        description: source.azureNewProjectDesc || '',
        repoName: source.azureTargetRepoName,
      })
      setResult(data)
      onChange({ azureTargetProject: data.project?.name, azureTargetProjectId: data.project?.id })
    } catch (e) {
      setError(formatUserError(e, { fallbackTitle: 'Failed to create project' }))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-3 pt-2">
      <Field label="New project name" htmlFor="azure-tgt-new-project-name">
        <Input
          id="azure-tgt-new-project-name"
          value={source.azureNewProjectName || ''}
          onChange={(e) => onChange({ azureNewProjectName: e.target.value })}
          placeholder="New-Project"
          leadingIcon={FolderPlus}
        />
      </Field>
      <Field label="Description (optional)" htmlFor="azure-tgt-new-project-desc">
        <Textarea
          id="azure-tgt-new-project-desc"
          value={source.azureNewProjectDesc || ''}
          onChange={(e) => onChange({ azureNewProjectDesc: e.target.value })}
          rows={2}
        />
      </Field>
      <Field label="Target repo name inside the new project" htmlFor="azure-tgt-new-repo-name">
        <Input
          id="azure-tgt-new-repo-name"
          value={source.azureTargetRepoName || ''}
          onChange={(e) => onChange({ azureTargetRepoName: e.target.value })}
          placeholder="my-new-repo"
          leadingIcon={FolderGit2}
        />
      </Field>
      <button
        type="button"
        onClick={createProject}
        disabled={creating || !source.azureNewProjectName?.trim()}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl ds-brand-solid disabled:bg-slate-300 disabled:cursor-not-allowed"
      >
        {creating ? <Spinner size="md" tone="onPrimary" /> : <Plus className="w-4 h-4" />}
        {creating ? 'Creating project…' : 'Create project now'}
      </button>
      {result && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          ✓ Project {result.project?.name} created{result.repo ? ` with repo ${result.repo.name}` : ''}.
        </p>
      )}
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error.title}</p>}
    </div>
  )
}
