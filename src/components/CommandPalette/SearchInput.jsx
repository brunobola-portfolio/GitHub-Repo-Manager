import { Command } from 'cmdk'
import { Sparkles } from 'lucide-react'
import { Spinner } from '../ui/Spinner'

/**
 * Command-palette search field. Renders the cmdk text input with ask-mode
 * affordances (Sparkles prefix + indigo styling) and a trailing spinner while
 * any live/ask search is in flight.
 *
 * Must be rendered inside a `<Command>` / `<Command.Dialog>` so cmdk's input
 * context is available. Purely presentational — the parent owns the input
 * value, ask-mode detection and loading state.
 *
 * @param {object} props
 * @param {boolean} props.askMode      — true when the query starts with `?`
 * @param {string}  props.value        — current input value
 * @param {(v: string) => void} props.onValueChange — cmdk value setter
 * @param {boolean} props.loading      — show the trailing spinner
 */
export function SearchInput({ askMode, value, onValueChange, loading }) {
  return (
    <div className="relative">
      {askMode && (
        <Sparkles
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-500"
          aria-hidden="true"
        />
      )}
      <Command.Input
        value={value}
        onValueChange={onValueChange}
        placeholder={askMode
          ? 'Ask anything — e.g. PRs touching payment I haven\'t reviewed'
          : 'Type a command or search PRs, issues, repos… (start with ? to ask)'}
        autoFocus
        className={`w-full py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 bg-transparent border-b outline-none ${
          askMode
            ? 'pl-10 pr-4 border-brand-200 dark:border-brand-800 placeholder:italic placeholder:text-brand-400/80'
            : 'px-4 border-slate-200 dark:border-slate-700'
        }`}
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">
          <Spinner size="sm" tone="muted" />
        </span>
      )}
    </div>
  )
}
