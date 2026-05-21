import { useEffect, useState } from 'react'
import { Cloud, FolderGit2, FolderPlus, Plus } from 'lucide-react'
import { Field, Input, Textarea } from '../../../ui/form'
import { Spinner } from '../../../ui/Spinner'
import { getCsrfToken } from '../../../../utils/api'

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
          Destino da migração
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ModeCard
            active={mode === 'github'}
            onClick={() => setMode('github')}
            icon={Cloud}
            title="GitHub"
            desc="Cria um repo novo no GitHub (fluxo principal)."
          />
          <ModeCard
            active={mode === 'same-project'}
            onClick={() => setMode('same-project')}
            icon={FolderGit2}
            title="Mesmo projecto Azure"
            desc="Cria um repo Git no mesmo projecto da source TFVC."
          />
          <ModeCard
            active={mode === 'existing-project'}
            onClick={() => setMode('existing-project')}
            icon={FolderGit2}
            title="Outro projecto Azure"
            desc="Cria o repo num projecto Azure existente da mesma organização."
          />
          <ModeCard
            active={mode === 'new-project'}
            onClick={() => setMode('new-project')}
            icon={FolderPlus}
            title="Novo projecto Azure"
            desc="Provisiona um projecto novo no Azure DevOps e cria o repo lá."
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
          ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`} />
        <span className={`text-sm font-medium ${active ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'}`}>
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
        O repo será criado no mesmo projecto da source ({source.project || '—'}).
      </p>
      <Field label="Nome do repo destino" htmlFor="azure-tgt-same-name">
        <Input
          id="azure-tgt-same-name"
          value={source.azureTargetRepoName || ''}
          onChange={(e) => onChange({ azureTargetRepoName: e.target.value })}
          placeholder="meu-repo-novo"
          leadingIcon={FolderGit2}
        />
      </Field>
    </div>
  )
}

function ExistingProjectForm({ source, onChange }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!source.org || !source.host) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError('')
      try {
        const csrfToken = await getCsrfToken().catch(() => null)
        const res = await fetch('/api/azure/projects', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
          body: JSON.stringify({ host: source.host, org: source.org, pat: source.pat }),
        })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(data.error || 'Failed to list projects')
        setProjects(data.projects || [])
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [source.host, source.org, source.pat])

  return (
    <div className="space-y-3 pt-2">
      <Field label="Projecto Azure DevOps destino" htmlFor="azure-tgt-existing-project">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner size="md" tone="muted" /> A carregar projectos…</div>
        ) : (
          <select
            id="azure-tgt-existing-project"
            value={source.azureTargetProject || ''}
            onChange={(e) => onChange({ azureTargetProject: e.target.value })}
            className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-sm"
          >
            <option value="">— escolhe um projecto —</option>
            {projects.map((p) => <option key={p.id || p.name} value={p.name}>{p.name}</option>)}
          </select>
        )}
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </Field>
      <Field label="Nome do repo destino" htmlFor="azure-tgt-existing-name">
        <Input
          id="azure-tgt-existing-name"
          value={source.azureTargetRepoName || ''}
          onChange={(e) => onChange({ azureTargetRepoName: e.target.value })}
          placeholder="meu-repo-novo"
          leadingIcon={FolderGit2}
        />
      </Field>
    </div>
  )
}

function NewProjectForm({ source, onChange }) {
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const createProject = async () => {
    setCreating(true); setError(''); setResult(null)
    try {
      const csrfToken = await getCsrfToken().catch(() => null)
      const res = await fetch('/api/azure/projects/create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
        body: JSON.stringify({
          host: source.host,
          org: source.org,
          pat: source.pat,
          name: source.azureNewProjectName,
          description: source.azureNewProjectDesc || '',
          repoName: source.azureTargetRepoName,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create project')
      setResult(data)
      onChange({ azureTargetProject: data.project?.name, azureTargetProjectId: data.project?.id })
    } catch (e) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-3 pt-2">
      <Field label="Nome do novo projecto" htmlFor="azure-tgt-new-project-name">
        <Input
          id="azure-tgt-new-project-name"
          value={source.azureNewProjectName || ''}
          onChange={(e) => onChange({ azureNewProjectName: e.target.value })}
          placeholder="Novo-Projecto"
          leadingIcon={FolderPlus}
        />
      </Field>
      <Field label="Descrição (opcional)" htmlFor="azure-tgt-new-project-desc">
        <Textarea
          id="azure-tgt-new-project-desc"
          value={source.azureNewProjectDesc || ''}
          onChange={(e) => onChange({ azureNewProjectDesc: e.target.value })}
          rows={2}
        />
      </Field>
      <Field label="Nome do repo destino dentro do novo projecto" htmlFor="azure-tgt-new-repo-name">
        <Input
          id="azure-tgt-new-repo-name"
          value={source.azureTargetRepoName || ''}
          onChange={(e) => onChange({ azureTargetRepoName: e.target.value })}
          placeholder="meu-repo-novo"
          leadingIcon={FolderGit2}
        />
      </Field>
      <button
        type="button"
        onClick={createProject}
        disabled={creating || !source.azureNewProjectName?.trim()}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
      >
        {creating ? <Spinner size="md" tone="onPrimary" /> : <Plus className="w-4 h-4" />}
        {creating ? 'A criar projecto…' : 'Criar projecto agora'}
      </button>
      {result && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          ✓ Projecto {result.project?.name} criado{result.repo ? ` com repo ${result.repo.name}` : ''}.
        </p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
