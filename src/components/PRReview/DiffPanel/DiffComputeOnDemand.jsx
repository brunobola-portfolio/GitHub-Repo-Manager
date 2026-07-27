import { useState } from 'react'
import { AlertTriangle, Cpu } from 'lucide-react'

/**
 * Placeholder for extreme-size files (>50,000 changed lines). Mounting
 * the lib's <DiffView> on something this large can stutter the tab even
 * with our other layered defences. Force an explicit user opt-in;
 * mirrors Monaco's `maxFileSize` pattern.
 *
 * @param {object} props
 * @param {string} props.filename
 * @param {number} [props.additions=0]
 * @param {number} [props.deletions=0]
 * @param {React.ReactNode} props.children  - The real diff to mount on demand.
 */
export function DiffComputeOnDemand({ filename, additions = 0, deletions = 0, children }) {
    const [computed, setComputed] = useState(false)
    const total = additions + deletions

    if (computed) return children

    return (
        <div className="diff-compute-on-demand p-6 text-center bg-amber-50/60 dark:bg-amber-900/10 border border-dashed border-amber-300 dark:border-amber-800/60 rounded-lg m-3">
            <p className="font-mono ds-text-meta text-slate-400 dark:text-slate-500 mb-1 truncate" title={filename}>
                {filename}
            </p>
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-200 dark:bg-amber-800/50 mb-3">
                <Cpu className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            </div>
            {/* Hero: line count. The big number is what the reviewer needs
                to decide whether to compute. Filename is footnote above. */}
            <p className="text-2xl font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {total} <span className="text-base font-medium text-slate-500 dark:text-slate-400">lines changed</span>
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 tabular-nums">
                <span className="ds-text-success">+{additions}</span>
                {' '}
                <span className="ds-text-danger">−{deletions}</span>
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-500 mt-3 max-w-md mx-auto inline-flex items-start gap-1.5 text-left">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>Diff not auto-rendered — files this large may take a moment to compute and may briefly slow the tab. Click when you&apos;re ready.</span>
            </p>
            <div className="mt-4">
                <button
                    type="button"
                    onClick={() => setComputed(true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 max-md:min-h-11 text-sm font-semibold rounded-lg bg-amber-600 text-white shadow-sm shadow-amber-600/30 hover:bg-amber-700 transition-colors"
                >
                    <Cpu className="w-3.5 h-3.5" /> Compute diff
                </button>
            </div>
        </div>
    )
}
