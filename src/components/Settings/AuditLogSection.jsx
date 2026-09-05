import { Shield, ArrowUpRight } from 'lucide-react'
import { formatDateTime } from '../../utils/format'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { PanelHeader } from '../ui/PanelHeader'
import { RowIconBadge } from '../ui/RowIconBadge'
import { Skeleton } from '../ui/Skeleton'
import { FeatureState } from '../states'
import { useAuditLog } from '../../hooks/useAuditLog'

/**
 * AuditLogSection — Settings > Audit Log tab.
 *
 * G6: this used to embed the whole filterable table inside the modal. The
 * table now lives at the dedicated `#/audit` page (src/components/Audit/
 * AuditLogPage.jsx) so it gets real screen space, a URL, and room for the
 * chain-verification and action-filter affordances that don't fit a modal
 * tab. This tab is now a short summary (most recent entry + total count)
 * plus a link to the full page.
 */
export function AuditLogSection() {
    const { logs, total, loading, error, fetchLogs } = useAuditLog({ limit: 1 })
    const latest = logs[0]

    return (
        <div className="space-y-5">
            <div className="flex items-start gap-3">
                <RowIconBadge icon={Shield} tone="purple" size="lg" surface="soft" />
                <PanelHeader
                    className="flex-1"
                    title="Audit Log"
                    description="Track all account activity and changes"
                />
            </div>

            {error ? (
                <FeatureState
                    error={error}
                    feature="Audit log"
                    benefits={[
                        'Track every authentication, repo and team change',
                        'Filter by action, resource and date range',
                        'Retain compliance-grade history for your account',
                    ]}
                    onRetry={fetchLogs}
                />
            ) : loading ? (
                <Skeleton variant="card" className="h-20" />
            ) : (
                <Card glass={false} shadow="sm" className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            {total > 0 ? `${total} logged ${total === 1 ? 'entry' : 'entries'}` : 'No entries yet'}
                        </p>
                        {latest && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                Most recent: <span className="font-mono">{latest.action}</span> — {formatDateTime(latest.created_at || latest.createdAt) || '—'}
                            </p>
                        )}
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { window.location.hash = '#/audit' }}
                        className="shrink-0"
                    >
                        Open audit log
                        <ArrowUpRight className="w-4 h-4" />
                    </Button>
                </Card>
            )}
        </div>
    )
}
