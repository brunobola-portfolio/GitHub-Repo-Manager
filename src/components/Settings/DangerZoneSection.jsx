import { useState } from 'react'
import { Download, AlertTriangle, Trash2, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { InsightCard } from '../ui/InsightCard'
import { ConfirmModal } from '../ui/ConfirmModal'
import { API_BASE_URL, MOCK_MODE } from '../../config'

/**
 * Settings — Danger Zone section.
 *
 * Exposes the two GDPR-required self-service endpoints:
 *
 *   GET  /api/v1/user/data/export  — article 20 (data portability)
 *   DELETE /api/v1/user/data       — article 17 (right to erasure)
 *
 * Both surfaces are opt-in, require explicit confirmation, and write to the
 * audit log. Erasure additionally requires the user to type the exact
 * confirmString ("ERASE MY DATA") via ConfirmModal's `requiresInput` prop.
 */
export function DangerZoneSection({ onErased }) {
    const [exporting, setExporting] = useState(false)
    const [exportMsg, setExportMsg] = useState(null)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [erasing, setErasing] = useState(false)

    const handleExport = async () => {
        if (MOCK_MODE) {
            setExportMsg({ type: 'error', text: 'Data export is disabled in demo mode. Set VITE_MOCK_MODE=false to use real exports.' })
            return
        }
        setExporting(true)
        setExportMsg(null)
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/user/data/export`, {
                credentials: 'include',
            })
            if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`)
            const blob = await res.blob()
            const disposition = res.headers.get('content-disposition') || ''
            const match = disposition.match(/filename="(.+?)"/)
            const filename = match ? match[1] : `data-export-${Date.now()}.json`

            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = filename
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
            setExportMsg({ type: 'success', text: `Download started: ${filename}` })
        } catch (err) {
            setExportMsg({ type: 'error', text: err.message || 'Export failed' })
        } finally {
            setExporting(false)
        }
    }

    const performErase = async () => {
        if (MOCK_MODE) {
            throw new Error('Account deletion is disabled in demo mode.')
        }
        setErasing(true)
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/user/data`, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmString: 'ERASE MY DATA' }),
            })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                throw new Error(body.error || `Erasure failed: HTTP ${res.status}`)
            }
            setConfirmOpen(false)
            onErased?.()
            // Hard reload so the app re-bootstraps without the (now tombstoned)
            // session cookie; the OAuth login screen will take over.
            setTimeout(() => { window.location.href = '/' }, 500)
        } finally {
            setErasing(false)
        }
    }

    return (
        <InsightCard
            tone="danger"
            hover={false}
            className="border-rose-300/60 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-950/10"
        >
            <div className="space-y-4">
                <div className="flex items-start gap-2">
                    <AlertTriangle size={18} className="text-rose-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <label className="text-sm font-semibold text-rose-700 dark:text-rose-300 block">
                            Danger Zone
                        </label>
                        <p className="text-xs text-rose-600/80 dark:text-rose-400/70 mt-0.5">
                            Export your data or permanently erase your account. Both actions are audit-logged.
                        </p>
                    </div>
                </div>

                {/* Export data */}
                <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-white/60 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-700/40">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Export my data</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Downloads a JSON file with your AI config, migration plans, events, and metadata (GDPR Art. 20).
                        </p>
                    </div>
                    <button
                        onClick={handleExport}
                        disabled={exporting}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                            bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
                            text-slate-700 dark:text-slate-200
                            hover:bg-indigo-50 dark:hover:bg-slate-700 hover:border-indigo-300 dark:hover:border-indigo-800
                            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        {exporting ? 'Exporting…' : 'Export'}
                    </button>
                </div>

                {exportMsg && (
                    <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${
                        exportMsg.type === 'success'
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                            : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                    }`}>
                        {exportMsg.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                        <span>{exportMsg.text}</span>
                    </div>
                )}

                {/* Delete account */}
                <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-white/60 dark:bg-slate-900/40 border border-rose-300/50 dark:border-rose-900/40">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-rose-700 dark:text-rose-300">Delete my account</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Permanently erases all personal data and tombstones your user record (GDPR Art. 17). Cancel any active subscription first.
                        </p>
                    </div>
                    <button
                        onClick={() => setConfirmOpen(true)}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                            bg-rose-600 text-white shadow-md shadow-rose-500/20
                            hover:bg-rose-500
                            transition-colors"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete account…
                    </button>
                </div>
            </div>

            <ConfirmModal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={performErase}
                title="Erase account — this cannot be undone"
                message="This permanently deletes every row of your personal data (AI config, migration plans, webhook events attributed to you, API keys, subscription records, team memberships). Your audit log entries are retained but anonymised. Type the confirmation below to proceed."
                confirmText="Erase account"
                cancelText="Cancel"
                variant="danger"
                requiresInput="ERASE MY DATA"
                isLoading={erasing}
            />
        </InsightCard>
    )
}
