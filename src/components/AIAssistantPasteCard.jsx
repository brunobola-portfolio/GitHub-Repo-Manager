import { useState } from 'react'
// Note: lucide-react does not export a `Github` icon; `GitBranch` is the
// closest thematic fit for the in-chat GitHub preview badge.
import { Wand2, X, ArrowRight, Check, Cloud, GitBranch } from 'lucide-react'
import { Button } from './ui/Button'
import { Field, Input } from './ui/form'

/**
 * Inline chat card that drives the paste-URL flow.
 *
 * Renders inline inside the AIAssistant chat scroll area — it is NOT an
 * overlaid modal, so it intentionally has no `role="dialog"`, focus trap,
 * or Escape handling. The cancel button (X) is the only dismissal vector.
 * The state object is still called `dialog` for historical continuity with
 * the assistant state machine.
 *
 * Pure presentational + local input state only. All interaction goes through
 * the three callbacks so the parent component (AIAssistant) owns the state
 * machine.
 *
 * @param {object} props
 * @param {object} props.dialog  Current dialog state (see state shape below)
 * @param {(field: string, value: string) => void} props.onAnswer
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 *
 * dialog shape:
 *   status:     'collecting' | 'ready'
 *   sourceType: 'azure' | 'github'
 *   parsed:     { org, project, repo }            for azure
 *               { owner, repo }                    for github
 *   answers:    { targetOrg?, targetName? }
 *   nextField:  'targetOrg' | 'targetName' | null
 */
export function AIAssistantPasteCard({ dialog, onAnswer, onConfirm, onCancel }) {
  const [value, setValue] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onAnswer(dialog.nextField, trimmed)
    setValue('')
  }

  const question = QUESTIONS[dialog.nextField]
  const isReady = dialog.status === 'ready'

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-900/20 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Wand2 className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
            URL detectado
          </p>
          <Preview dialog={dialog} />
          <ConfirmedAnswers dialog={dialog} />
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar"
          className="p-1 rounded hover:bg-white/50 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {!isReady && question && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <Field
            label={question.label}
            htmlFor={`paste-dialog-${dialog.nextField}`}
            hint={question.hint}
          >
            <div className="flex gap-2">
              <Input
                id={`paste-dialog-${dialog.nextField}`}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={question.placeholder}
                size="sm"
                className="flex-1"
              />
              <Button type="submit" variant="primary" size="xs" disabled={!value.trim()}>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </Field>
        </form>
      )}

      {isReady && (
        <Button type="button" variant="primary" size="sm" onClick={onConfirm} className="w-full">
          <Check className="w-4 h-4" /> Abrir wizard com isto preenchido
        </Button>
      )}
    </div>
  )
}

function Preview({ dialog }) {
  if (dialog.sourceType === 'azure') {
    const { org, project, repo } = dialog.parsed || {}
    return (
      <p className="text-sm text-slate-700 dark:text-slate-200 flex items-center gap-1 flex-wrap">
        <Cloud className="w-3 h-3 text-indigo-500" /> Azure DevOps
        {org && <> &middot; <span className="font-mono">{org}</span></>}
        {project && <> / <span className="font-mono">{project}</span></>}
        {repo && <> / <span className="font-mono">{repo}</span></>}
      </p>
    )
  }
  if (dialog.sourceType === 'github') {
    const { owner, repo } = dialog.parsed || {}
    return (
      <p className="text-sm text-slate-700 dark:text-slate-200 flex items-center gap-1 flex-wrap">
        <GitBranch className="w-3 h-3 text-slate-700 dark:text-slate-200" /> GitHub
        {owner && <> &middot; <span className="font-mono">{owner}</span></>}
        {repo && <> / <span className="font-mono">{repo}</span></>}
      </p>
    )
  }
  return null
}

function ConfirmedAnswers({ dialog }) {
  const entries = Object.entries(dialog.answers || {})
  if (entries.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
      {entries.map(([k, v]) => (
        <li key={k} className="flex items-center gap-1">
          <Check className="w-3 h-3 text-emerald-500" />
          <span className="font-medium">{ANSWER_LABELS[k] || k}:</span>
          <span className="font-mono">{v}</span>
        </li>
      ))}
    </ul>
  )
}

const QUESTIONS = {
  targetOrg: {
    label: 'Qual a GitHub org de destino?',
    placeholder: 'p.ex. bolalabs',
    hint: 'Organização ou utilizador GitHub onde o repo vai ser criado.',
  },
  targetName: {
    label: 'Nome final do repo no GitHub?',
    placeholder: 'escreve "manter" para usar o original',
    hint: 'Escreve "manter" para manter o nome detetado.',
  },
}

const ANSWER_LABELS = {
  targetOrg: 'GitHub org',
  targetName: 'Nome final',
}
