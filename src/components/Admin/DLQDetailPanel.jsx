// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
/**
 * DLQDetailPanel — side drawer showing the full entry payload.
 *
 * Email entries include potentially-sensitive HTML/text bodies (license
 * keys, reset tokens). We render them in a `<pre>` inside a bordered box
 * to signal "this is raw, don't paste it into slack" without introducing
 * an inline iframe / dangerouslySetInnerHTML vector.
 *
 * Webhook entries include the full GitHub payload — usually JSON. We
 * pretty-print if parseable; otherwise show verbatim.
 */
import { Drawer } from '../ui/Drawer'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { RotateCw, CheckCircle2 } from 'lucide-react'
import { SectionSpinner } from '../ui/Spinner'

function formatTimestamp(iso) {
    if (!iso) return '—'
    const ts = typeof iso === 'string' && !iso.includes('T') ? iso.replace(' ', 'T') + 'Z' : iso
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
}

function tryPrettyJson(raw) {
    if (!raw || typeof raw !== 'string') return raw
    try {
        return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
        return raw
    }
}

function Field({ label, value, mono = false }) {
    return (
        <div className="grid grid-cols-[120px_1fr] gap-3 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {label}
            </div>
            <div className={`text-sm text-slate-700 dark:text-slate-300 break-all ${mono ? 'font-mono' : ''}`}>
                {value ?? <span className="text-slate-400">—</span>}
            </div>
        </div>
    )
}

function BodyBlock({ title, content, pretty = false }) {
    if (!content) return null
    const rendered = pretty ? tryPrettyJson(content) : content
    return (
        <section className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                {title}
            </h3>
            <pre className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-[300px]">
                {rendered}
            </pre>
        </section>
    )
}

export function DLQDetailPanel({
    kind, // 'email' | 'webhook'
    entry,
    loading,
    isOpen,
    onClose,
    onRetry,
    onResolve,
    busy,
}) {
    const title = kind === 'email' ? 'Email DLQ entry' : 'Webhook DLQ entry'
    const subtitle = entry ? `#${entry.id}` : undefined
    const resolved = !!entry?.resolved_at

    return (
        <Drawer isOpen={isOpen} onClose={onClose} title={title} subtitle={subtitle} width={560} closeOnBackdrop={false}>
            <div className="p-6">
            {loading && (
                <SectionSpinner padding="py-12" tone="muted" />
            )}

            {!loading && entry && (
                <div className="space-y-4">
                    <Card glass={false} shadow="sm" className="rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Metadata
                            </div>
                            {resolved
                                ? <Badge variant="success">Resolved</Badge>
                                : <Badge variant="warning">Pending</Badge>}
                        </div>

                        {kind === 'email' ? (
                            <>
                                <Field label="To" value={entry.to_address} />
                                <Field label="Subject" value={entry.subject} />
                            </>
                        ) : (
                            <>
                                <Field label="Delivery ID" value={entry.delivery_id} mono />
                                <Field label="Event type" value={entry.event_type} mono />
                            </>
                        )}
                        <Field label="Attempts" value={entry.attempts ?? 0} mono />
                        <Field label="Created" value={formatTimestamp(entry.created_at)} />
                        <Field label="Next retry" value={formatTimestamp(entry.next_retry_at)} />
                        {entry.resolved_at && (
                            <Field label="Resolved at" value={formatTimestamp(entry.resolved_at)} />
                        )}
                        <Field label="Last error" value={entry.last_error} />
                    </Card>

                    {kind === 'email' && (
                        <>
                            <BodyBlock title="Text body" content={entry.body_text} />
                            <BodyBlock title="HTML body" content={entry.body_html} />
                            {entry.context_json && (
                                <BodyBlock title="Context" content={entry.context_json} pretty />
                            )}
                        </>
                    )}

                    {kind === 'webhook' && (
                        <BodyBlock title="Payload" content={entry.payload} pretty />
                    )}

                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onRetry(entry)}
                            disabled={busy || resolved}
                        >
                            <RotateCw className="w-4 h-4" />
                            Retry now
                        </Button>
                        <Button
                            variant="success"
                            size="sm"
                            onClick={() => onResolve(entry)}
                            disabled={busy || resolved}
                        >
                            <CheckCircle2 className="w-4 h-4" />
                            Mark resolved
                        </Button>
                    </div>
                </div>
            )}
            </div>
        </Drawer>
    )
}
