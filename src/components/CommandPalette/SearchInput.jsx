import { Command } from 'cmdk'
import { Sparkles, GitFork } from 'lucide-react'
import { Spinner } from '../ui/Spinner'

/**
 * Command-palette search field. Renders the cmdk text input with ask-mode
 * affordances (Sparkles prefix + indigo styling), a repo-scoped breadcrumb
 * chip (second-level "Repo Actions" drill-down), and a trailing spinner
 * while any live/ask search is in flight.
 *
 * Must be rendered inside a `<Command>` / `<Command.Dialog>` so cmdk's input
 * context is available. Purely presentational — the parent owns the input
 * value, ask-mode detection, drill-down mode and loading state.
 *
 * @param {object} props
 * @param {boolean} props.askMode      — true when the query starts with `?`
 * @param {string}  props.value        — current input value
 * @param {(v: string) => void} props.onValueChange — cmdk value setter
 * @param {boolean} props.loading      — show the trailing spinner
 * @param {string|null} [props.breadcrumb] — repo full_name when the palette
 *   is drilled into that repo's scoped action list; renders a chip in place
 *   of the ask-mode Sparkles icon and swaps the placeholder copy.
 * @param {(e: React.KeyboardEvent) => void} [props.onKeyDown] — forwarded to
 *   the underlying cmdk input; used for Backspace-to-pop-back in drill mode.
 */
export function SearchInput({ askMode, value, onValueChange, loading, breadcrumb = null, onKeyDown }) {
  return (
    <div className="relative flex items-center">
      {askMode && (
        <Sparkles
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-500"
          aria-hidden="true"
        />
      )}
      {!askMode && breadcrumb && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2 py-1 rounded-md ds-text-meta font-medium bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200/70 dark:border-brand-700/50 max-w-[45%]">
          <GitFork className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{breadcrumb}</span>
        </span>
      )}
      <Command.Input
        value={value}
        onValueChange={onValueChange}
        onKeyDown={onKeyDown}
        placeholder={askMode
          ? 'Ask anything — e.g. PRs touching payment I haven\'t reviewed'
          : breadcrumb
            ? 'Search actions… (Backspace to go back)'
            : 'Type a command or search PRs, issues, repos… (start with ? to ask)'}
        autoFocus
        className={`w-full py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 bg-transparent border-b outline-none focus-visible:border-brand-500 dark:focus-visible:border-brand-400 ${
          askMode
            ? 'pl-10 pr-4 border-brand-200 dark:border-brand-800 placeholder:italic placeholder:text-brand-400/80'
            : breadcrumb
              ? 'pl-[9.5rem] pr-4 border-slate-200 dark:border-slate-700'
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
