import { Shield, Filter, RefreshCw, Download, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { PageShell } from '../ui/PageShell'
import { PageHeader } from '../ui/PageHeader'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/form'
import { Select } from '../ui/Select'
import { Badge } from '../ui/Badge'
import { useAuditLog } from '../../hooks/useAuditLog'
import { AuditLogTable } from './AuditLogTable'

/**
 * AuditLogPage — the full `#/audit` view (G6). Enterprise-only, same as the
 * Settings > Audit Log tab it supersedes as the primary surface; that tab
 * now shows a short summary + a link here rather than duplicating the table.
 */
export function AuditLogPage() {
    const {
        logs, total, loading, error, fetchLogs,
        action, setAction, dateFrom, setDateFrom, dateTo, setDateTo,
        page, setPage, limit, totalPages,
        actionOptions, actionsLoading,
        exporting, handleExport,
        verifying, verifyResult, runVerify,
    } = useAuditLog({ limit: 20 })

    const actionSelectOptions = [
        { value: '', label: 'All Actions' },
        ...actionOptions.map((a) => ({ value: a, label: a })),
    ]

    return (
        <PageShell maxWidth="3xl">
            <PageHeader
                icon={Shield}
                eyebrow="Enterprise"
                title="Audit Log"
                description="Every authentication, repo and team change, in an append-only, tamper-evident log."
                actions={(
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={runVerify}
                        disabled={verifying}
                        title="Recompute the hash chain and confirm no row has been altered"
                    >
                        {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                        Verify chain
                    </Button>
                )}
            />

            {verifyResult && (
                <div className="mb-5">
                    {verifyResult.error ? (
                        <Badge tone="danger" icon={<XCircle className="w-3.5 h-3.5" />}>
                            {verifyResult.error?.message || 'Verification failed'}
                        </Badge>
                    ) : verifyResult.ok ? (
                        <Badge tone="success" icon={<CheckCircle2 className="w-3.5 h-3.5" />}>
                            Chain intact — {verifyResult.checked} {verifyResult.checked === 1 ? 'entry' : 'entries'} verified
                        </Badge>
                    ) : (
                        <Badge tone="danger" icon={<XCircle className="w-3.5 h-3.5" />}>
                            Chain broken at entry #{verifyResult.brokenAt} — {verifyResult.checked} entries checked before the break
                        </Badge>
                    )}
                </div>
            )}

            <div className="flex flex-wrap gap-3 items-end mb-5">
                <div className="flex flex-col gap-1">
                    <span id="audit-page-action-label" className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1">
                        <Filter className="w-3 h-3" /> Action
                    </span>
                    <Select
                        label="Filter by action"
                        value={action}
                        onChange={(v) => setAction(v)}
                        options={actionSelectOptions}
                        loading={actionsLoading}
                        className="w-52"
                    />
                </div>

                <Field label="From" htmlFor="audit-page-date-from">
                    <Input id="audit-page-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </Field>

                <Field label="To" htmlFor="audit-page-date-to">
                    <Input id="audit-page-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </Field>

                <Button variant="secondary" size="sm" onClick={fetchLogs} title="Refresh">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>

                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleExport('csv')}
                    disabled={exporting || !!error}
                    title="Download the filtered audit log as CSV"
                >
                    <Download className="w-4 h-4" />
                    Export CSV
                </Button>

                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleExport('json')}
                    disabled={exporting || !!error}
                    title="Download the filtered audit log as JSON"
                >
                    <Download className="w-4 h-4" />
                    Export JSON
                </Button>
            </div>

            <AuditLogTable
                logs={logs}
                total={total}
                page={page}
                limit={limit}
                totalPages={totalPages}
                loading={loading}
                error={error}
                onRetry={fetchLogs}
                onPrevPage={() => setPage((p) => Math.max(1, p - 1))}
                onNextPage={() => setPage((p) => Math.min(totalPages, p + 1))}
                maxHeight="600px"
            />
        </PageShell>
    )
}
