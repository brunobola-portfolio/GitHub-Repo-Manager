import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

export function ProgressBar({
    current,
    total,
    status = 'running', // running, success, error
    message = '',
    results = [] // Array of { name, success, error }
}) {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0

    const statusColors = {
        running: 'bg-blue-500',
        success: 'bg-emerald-500',
        error: 'bg-red-500'
    }

    return (
        <div className="space-y-3">
            {/* Progress Header */}
            <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                    {status === 'running' && 'Processing...'}
                    {status === 'success' && 'Completed'}
                    {status === 'error' && 'Failed'}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                    {current} / {total}
                </span>
            </div>

            {/* Progress Bar */}
            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                    className={`h-full transition-all duration-300 ${statusColors[status]}`}
                    style={{ width: `${percentage}%` }}
                />
            </div>

            {/* Message */}
            {message && (
                <p className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-2">
                    {status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
                    {status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                    {status === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
                    {message}
                </p>
            )}

            {/* Results List */}
            {results.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                    {results.map((r, i) => (
                        <div
                            key={i}
                            className={`text-xs px-2 py-1 rounded flex items-center gap-2 ${
                                r.success
                                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                                    : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                            }`}
                        >
                            {r.success ? (
                                <CheckCircle className="w-3 h-3" />
                            ) : (
                                <XCircle className="w-3 h-3" />
                            )}
                            <span className="font-medium truncate">{r.name}</span>
                            {r.error && (
                                <span className="text-red-500 dark:text-red-400 truncate ml-auto">{r.error}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

