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
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-200 dark:bg-amber-800/50 mb-3">
                <Cpu className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                <span className="font-mono">{filename}</span>
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                {total} lines changed — diff not auto-rendered
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-500 mt-2 max-w-md mx-auto inline-flex items-start gap-1.5 text-left">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>Files this large may take a moment to render and may briefly slow the tab. Click to compute when you&apos;re ready.</span>
            </p>
            <div className="mt-4">
                <button
                    type="button"
                    onClick={() => setComputed(true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                >
                    <Cpu className="w-3.5 h-3.5" /> Compute diff
                </button>
            </div>
        </div>
    )
}
