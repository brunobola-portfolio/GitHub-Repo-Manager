import { Sparkles } from 'lucide-react'

/**
 * Ask-mode header: the translator's natural-language interpretation of the
 * query, plus a hint when no GitHub query could be inferred. The result
 * groups it precedes (`AskModeResults`) stay inline in CommandPalette.
 *
 * @param {object} props
 * @param {string}  props.summary    — the AI's plain-language interpretation
 * @param {boolean} props.hasQueries — whether any GitHub query was inferred
 */
export function AskModeBanner({ summary, hasQueries }) {
  return (
    <>
      <div className="px-3 pt-3 pb-2 flex items-start gap-2">
        <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-[2px]" aria-hidden="true" />
        <p className="text-xs italic text-indigo-700 dark:text-indigo-300">
          {summary}
        </p>
      </div>
      {!hasQueries && (
        <div className="px-3 pb-3 ds-text-meta text-slate-400 dark:text-slate-500">
          No GitHub query inferred. Try rephrasing or remove the leading "?".
        </div>
      )}
    </>
  )
}
