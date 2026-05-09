import { useState } from 'react'
import { ChevronDown, ChevronUp, RotateCcw, Sparkles } from 'lucide-react'

const SIGNAL_LABELS = {
    readme: 'README',
    manifest: 'Manifest (package.json / pyproject.toml / …)',
    entrypoints: 'Entrypoints (up to 3)',
    folderStructure: 'Folder structure (top-level dirs)',
    topics: 'Topics',
    language: 'Language',
}

// Static "expected size" used for the byte meter — close enough to the
// real per-signal cap that the user gets a useful sense of cost without
// the picker round-tripping a fetch on every toggle change.
const EXPECTED_BYTES = {
    readme: 1500,
    manifest: 600,
    entrypoints: 1200,
    folderStructure: 200,
    topics: 100,
    language: 30,
}

const TOTAL_CAP = 8192

function formatKb(bytes) {
    return `${(bytes / 1024).toFixed(1)} KB`
}

export function ContextPicker({
    mode = 'single',
    signals,
    onSignalChange,
    customFiles = [],
    onAddCustomFile,
    onRemoveCustomFile,
    onReset,
}) {
    const [open, setOpen] = useState(false)
    const enabledKeys = Object.keys(signals).filter((k) => signals[k])
    const totalBytes = enabledKeys.reduce((n, k) => n + (EXPECTED_BYTES[k] || 0), 0)
    const onCount = enabledKeys.length

    return (
        <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200"
                aria-expanded={open}
            >
                <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                    Context ({onCount} signals on, {formatKb(totalBytes)})
                </span>
                {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {open && (
                <div className="px-3 pb-3 pt-1 space-y-2">
                    {Object.keys(SIGNAL_LABELS).map((kind) => {
                        const checked = !!signals[kind]
                        const expected = EXPECTED_BYTES[kind] || 0
                        return (
                            <label key={kind} className="flex items-center gap-2 text-sm cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => onSignalChange(kind, e.target.checked)}
                                    aria-label={SIGNAL_LABELS[kind]}
                                    className="accent-indigo-500"
                                />
                                <span className="flex-1 text-slate-700 dark:text-slate-200">{SIGNAL_LABELS[kind]}</span>
                                {checked && <span className="text-xs text-slate-500">{formatKb(expected)}</span>}
                            </label>
                        )
                    })}

                    {mode === 'single' && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                            <button
                                type="button"
                                onClick={() => onAddCustomFile?.()}
                                disabled={customFiles.length >= 5}
                                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                            >
                                + Add specific file ({customFiles.length}/5)
                            </button>
                            {customFiles.length > 0 && (
                                <ul className="mt-1 flex flex-wrap gap-1">
                                    {customFiles.map((f) => (
                                        <li key={f.path} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-xs text-indigo-700 dark:text-indigo-300">
                                            {f.path}
                                            <button
                                                type="button"
                                                onClick={() => onRemoveCustomFile?.(f.path)}
                                                aria-label={`Remove ${f.path}`}
                                                className="text-indigo-500 hover:text-indigo-700"
                                            >
                                                ×
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                        <span className="text-xs text-slate-500">
                            {`Total: ${formatKb(totalBytes)} / ${formatKb(TOTAL_CAP)}`}
                        </span>
                        <button
                            type="button"
                            onClick={onReset}
                            className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
                        >
                            <RotateCcw className="w-3 h-3" /> Reset
                        </button>
                    </div>
                </div>
            )}
        </section>
    )
}
