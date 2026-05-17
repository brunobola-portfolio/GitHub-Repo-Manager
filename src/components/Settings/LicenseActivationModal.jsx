import { useState } from 'react'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Field, Textarea } from '../ui/form'
import { Loader2, CheckCircle2, XCircle, Sparkles } from 'lucide-react'
import { fetchWithRetry } from '../../utils/api'
import { formatUserError } from '../../utils/errors'

export function LicenseActivationModal({ isOpen, onClose }) {
  const [keyInput, setKeyInput] = useState('')
  const [activating, setActivating] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleActivate = async () => {
    if (!keyInput.trim()) return
    setActivating(true)
    setError(null)
    setResult(null)
    try {
      // /install validates the key, persists it to the installed_license
      // table, refreshes the in-memory tier cache, and returns the active
      // license payload. No server restart required.
      const res = await fetchWithRetry('/api/v1/license/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyInput.trim() })
      })
      const data = await res.json()
      setResult(data)
      // Notify the rest of the app (useLicense + TierContext consumers) so
      // Pro-gated surfaces unlock immediately, no refresh needed.
      window.dispatchEvent(new CustomEvent('app:license-changed'))
    } catch (err) {
      // ApiError on non-2xx — surface the server message verbatim. Network
      // blips fall through to formatUserError so the catch path never leaks
      // raw "Failed to fetch" / TypeError text.
      if (err?.status === 409 && err?.data?.error === 'env_license_set') {
        setError('LICENSE_KEY is set in this server\'s .env — UI activation is disabled. Remove the env var (or update it directly) and restart the server.')
      } else if (err?.status && err?.data?.error) {
        setError(err.data.error)
      } else {
        const formatted = formatUserError(err, { fallbackTitle: 'Activation failed' })
        setError(formatted.body || formatted.title)
      }
    } finally {
      setActivating(false)
    }
  }

  const handleClose = () => {
    setKeyInput('')
    setResult(null)
    setError(null)
    onClose()
  }

  const formattedExpires = result?.expiresAt
    ? new Date(result.expiresAt).toLocaleDateString()
    : null

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Activate License"
      size="lg"
      closeOnBackdrop={false}
      data-testid="license-activation-modal"
      footer={
        <ModalFooter align="between">
          <Button variant="ghost" onClick={handleClose}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              variant="primary"
              onClick={handleActivate}
              disabled={!keyInput.trim() || activating}
              data-testid="license-activate-button"
            >
              {activating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Activating…</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Activate License</>
              )}
            </Button>
          )}
        </ModalFooter>
      }
    >
      <div className="space-y-4">
        {!result && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Paste your license key below. Activation is instant — your plan
            updates as soon as the key is verified, no server restart needed.
          </p>
        )}
        {!result && (
          <Field label="License key" htmlFor="license-key-input">
            <Textarea
              id="license-key-input"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="grm_lic_eyJ..."
              className="font-mono text-xs"
              rows={5}
              autoFocus
            />
          </Field>
        )}
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-300 text-sm flex gap-2.5" role="alert">
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Activation failed</p>
              <p className="text-xs mt-1">{error}</p>
            </div>
          </div>
        )}
        {result && (
          <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 space-y-3" data-testid="license-activated-card">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">License activated</p>
                <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">Your plan and Pro features are now live across the app.</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  <div className="flex gap-2"><dt className="text-slate-500">Tier:</dt><dd className="font-medium capitalize">{result.tier}</dd></div>
                  {result.org && <div className="flex gap-2"><dt className="text-slate-500">Organization:</dt><dd className="font-medium">{result.org}</dd></div>}
                  {result.email && <div className="flex gap-2"><dt className="text-slate-500">Email:</dt><dd className="font-medium">{result.email}</dd></div>}
                  {result.seats && <div className="flex gap-2"><dt className="text-slate-500">Seats:</dt><dd className="font-medium">{result.seats}</dd></div>}
                  {formattedExpires && <div className="flex gap-2"><dt className="text-slate-500">Expires:</dt><dd className="font-medium">{formattedExpires}</dd></div>}
                </dl>
                {result.bootstrap && (
                  <p
                    className="mt-3 text-xs text-emerald-800 dark:text-emerald-300 bg-emerald-100/60 dark:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-900 rounded px-2 py-1.5"
                    data-testid="bootstrap-admin-note"
                  >
                    You've also been granted <strong>admin</strong> access for this instance, so you can replace or uninstall the license later.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
