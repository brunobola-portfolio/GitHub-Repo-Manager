// src/components/Settings/EnvironmentToolingSection.jsx
import { useState, useCallback } from 'react'
import { ShieldAlert, RefreshCw, Download, CheckCircle2, AlertTriangle, XCircle, MinusCircle } from 'lucide-react'
import { apiCall } from '../../utils/api'
import { useToast } from '../../hooks/useToast'
import { useTabData } from '../../hooks/useTabData.js'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Skeleton } from '../ui/Skeleton'
import { PanelHeader } from '../ui/PanelHeader'

const STATUS_META = {
  ok:        { Icon: CheckCircle2, accent: 'text-emerald-500', label: 'OK' },
  outdated:  { Icon: AlertTriangle, accent: 'text-amber-500',  label: 'Outdated' },
  missing:   { Icon: XCircle,       accent: 'text-red-500',     label: 'Missing' },
  'n/a':     { Icon: MinusCircle,   accent: 'text-slate-400',   label: 'N/A' },
}

export function EnvironmentToolingSection({ isAdmin = false }) {
  const { toast } = useToast()
  const [installingId, setInstallingId] = useState(null)
  const { data, loading, error, reload } = useTabData(() => apiCall('/api/env/tooling'), [])

  const install = useCallback(async (id, label) => {
    setInstallingId(id)
    try {
      await apiCall(`/api/env/tooling/${id}/install`, { method: 'POST' })
      toast.success(`${label} install triggered`)
      await reload()
    } catch (err) {
      toast.errorFromException(err, { fallbackTitle: 'Install failed' })
    } finally {
      setInstallingId(null)
    }
  }, [reload, toast])

  if (!isAdmin) {
    return <EmptyState icon={ShieldAlert} title="Admin only" description="Migration tooling management is restricted to operator (admin) accounts." />
  }
  if (loading) {
    return <div className="space-y-3">{[0, 1, 2, 3].map((k) => <Skeleton key={k} variant="card" className="h-16" />)}</div>
  }
  if (error) {
    return <EmptyState icon={AlertTriangle} title="Couldn't load tooling status" description={error?.message ?? 'An unexpected error occurred'} action={{ label: 'Retry', onClick: reload }} />
  }

  const tools = data?.tools ?? []
  const preferred = data?.managers?.preferred

  return (
    <div className="space-y-5">
      <PanelHeader
        eyebrow="Migration tooling"
        title={data?.readiness?.ok ? 'All required tools ready' : 'Some tools need attention'}
        description={`Platform ${data?.platform} · package manager ${preferred ?? 'none detected'}`}
        actions={<Button variant="secondary" size="sm" onClick={reload}><RefreshCw className="w-3.5 h-3.5" /> Refresh</Button>}
      />
      <div className="space-y-2">
        {tools.map((t) => {
          const meta = STATUS_META[t.status] ?? STATUS_META['n/a']
          const canInstall = t.status === 'missing' || t.status === 'outdated'
          return (
            <Card key={t.id} glass={false} shadow="sm" className="p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <meta.Icon className={`w-4 h-4 ${meta.accent}`} aria-hidden="true" />
                <span className="font-semibold">{t.label}</span>
                {t.version && <span className="ds-text-meta text-slate-400 tabular-nums">{t.version}</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`ds-text-meta uppercase tracking-wide ${meta.accent}`}>{meta.label}</span>
                {canInstall && preferred && (
                  <Button variant="primary" size="sm" disabled={installingId === t.id} onClick={() => install(t.id, t.label)}>
                    <Download className={`w-3.5 h-3.5 ${installingId === t.id ? 'animate-pulse' : ''}`} /> Install
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
