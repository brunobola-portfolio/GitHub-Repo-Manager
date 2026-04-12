import { Shield, Clock, AlertTriangle } from 'lucide-react'

const RISK_COLORS = {
    low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

export function QuickSummary({ summary, loading, error, onRetry }) {
    if (loading) {
        return (
            <div className="space-y-3">
                <div className="h-8 w-32 ds-skeleton rounded" />
                <div className="h-24 ds-skeleton rounded-xl" />
                <div className="h-16 ds-skeleton rounded-xl" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="text-center py-6">
                <p className="text-sm text-red-500 dark:text-red-400 mb-2">{error}</p>
                <button type="button" onClick={onRetry} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Retry</button>
            </div>
        )
    }

    if (!summary) return null

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${RISK_COLORS[summary.overallRisk] || RISK_COLORS.low}`}>
                    <Shield className="w-3 h-3" />
                    {summary.overallRisk?.charAt(0).toUpperCase() + summary.overallRisk?.slice(1)} risk
                </span>
                {summary.estimatedReviewTime && (
                    <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <Clock className="w-3 h-3" />
                        {summary.estimatedReviewTime}
                    </span>
                )}
            </div>

            <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{summary.overview}</div>

            {summary.keyChanges?.length > 0 && (
                <div>
                    <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Key Changes</h4>
                    <ul className="space-y-1">
                        {summary.keyChanges.map((change, i) => (
                            <li key={i} className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                                <span className="text-indigo-400 mt-0.5">•</span>
                                {change}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {summary.fileRisks?.length > 0 && (
                <div>
                    <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wide">High-Risk Files</h4>
                    <div className="space-y-1">
                        {summary.fileRisks.slice(0, 5).map((file, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                                <AlertTriangle className={`w-3 h-3 ${file.level === 'high' || file.level === 'critical' ? 'text-red-500' : 'text-amber-500'}`} />
                                <span className="font-mono text-slate-600 dark:text-slate-300 truncate flex-1">{file.filename}</span>
                                <span className="text-slate-400 shrink-0">{file.reason}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
