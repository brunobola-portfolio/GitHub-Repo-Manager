import { motion } from 'framer-motion'
import { Tags, ShieldCheck, GitBranch, EyeOff } from 'lucide-react'
import { DEFAULT_TAGGING_POLICY } from './taggingDefaults'

function Toggle({ id, checked, onChange, label, hint, icon: Icon, warning }) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-3 rounded-lg border border-slate-200/60 dark:border-white/5 p-3 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer transition"
    >
      <input
        id={id}
        type="checkbox"
        checked={!!checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-1 accent-violet-500"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm text-slate-900 dark:text-slate-100">
          {Icon ? <Icon className="w-3.5 h-3.5 text-slate-400" aria-hidden /> : null}
          <span className="font-medium">{label}</span>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{hint}</div>
        {warning ? (
          <div className="mt-1 text-xs text-amber-600 dark:text-amber-300/80" role="alert">
            ⚠ {warning}
          </div>
        ) : null}
      </div>
    </label>
  )
}

/**
 * Premium UX panel for the migration tagging policy. Used standalone in
 * tests and inline inside ScheduleStep (the last decision page) so the
 * user can confirm or tweak before kicking off the migration.
 */
export function TaggingPolicyPanel({ policy = DEFAULT_TAGGING_POLICY, onChange, capabilities = null }) {
  const setField = (k, v) => onChange({ ...policy, [k]: v })

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <header className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-violet-500/10 ring-1 ring-inset ring-violet-500/20">
          <Tags className="w-4 h-4 text-violet-500 dark:text-violet-300" aria-hidden />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Marcação da migração</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Deixa rasto nos três sítios onde importa: na origem, no destino, e no histórico git.
          </p>
        </div>
      </header>

      <label className="flex items-center gap-3 rounded-xl border border-violet-200/60 dark:border-violet-500/20 bg-violet-500/5 p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={!!policy.enabled}
          onChange={e => setField('enabled', e.target.checked)}
          className="accent-violet-500"
          aria-label="Ativar marcação"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-900 dark:text-slate-100 font-medium">Ativar marcação</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Master switch. Desativa para esta migração não escrever nada.</div>
        </div>
      </label>

      <fieldset
        disabled={!policy.enabled}
        className={!policy.enabled ? 'opacity-50 pointer-events-none' : ''}
        aria-label="Onde marcar a migração"
      >
        <div className="grid gap-2">
          <Toggle
            id="taggingDestination"
            icon={ShieldCheck}
            checked={policy.writeDestination}
            onChange={v => setField('writeDestination', v)}
            label="Marcar destino (GitHub)"
            hint="Topics + descrição + custom properties (org)"
          />
          <Toggle
            id="taggingSource"
            icon={ShieldCheck}
            checked={policy.writeSource}
            onChange={v => setField('writeSource', v)}
            label="Marcar origem (Azure DevOps)"
            hint="Project properties + descrição do repo. Requer PAT com Project & Team (Write)."
            warning={capabilities?.azure?.missingScopes?.length ? `PAT em falta de scope: ${capabilities.azure.missingScopes.join(', ')}` : null}
          />
          <Toggle
            id="taggingGitTag"
            icon={GitBranch}
            checked={policy.writeGitTag}
            onChange={v => setField('writeGitTag', v)}
            label="Criar git tag anotada"
            hint="Visível em qualquer clone, independente do hoster."
          />
          <Toggle
            id="taggingHideSource"
            icon={EyeOff}
            checked={policy.hideSourceName}
            onChange={v => setField('hideSourceName', v)}
            label="Ocultar nome da origem em topics públicos"
            hint="Substitui o nome do projeto por um hash curto. Útil para repos open-source."
          />
        </div>
      </fieldset>
    </motion.div>
  )
}
