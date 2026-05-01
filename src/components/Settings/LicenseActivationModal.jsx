import { useState } from 'react'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Loader2, CheckCircle2, XCircle, Copy, Check } from 'lucide-react'
import { getCsrfToken } from '../../utils/api'
import { formatUserError } from '../../utils/errors'

export function LicenseActivationModal({ isOpen, onClose }) {
  const [keyInput, setKeyInput] = useState('')
  const [validating, setValidating] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const handleValidate = async () => {
    if (!keyInput.trim()) return
    setValidating(true)
    setError(null)
    setResult(null)
    try {
      const headers = { 'Content-Type': 'application/json' }
      try { headers['X-CSRF-Token'] = await getCsrfToken() } catch { /* server will 403 */ }
      const res = await fetch('/api/v1/license/validate', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ key: keyInput.trim() })
      })
      const data = await res.json()
      if (!res.ok || !data.valid) {
        setError(data.error || 'Invalid license key')
      } else {
        setResult(data)
      }
    } catch (err) {
      // Network failure / unexpected exception — formatUserError gives a
      // readable title+body without leaking raw stack traces or
      // Failed-to-fetch jargon to the user.
      const formatted = formatUserError(err, { fallbackTitle: 'Validation failed' })
      setError(formatted.body || formatted.title)
    } finally {
      setValidating(false)
    }
  }

  const envSnippet = `LICENSE_KEY=${keyInput.trim()}`

  const handleCopy = () => {
    navigator.clipboard.writeText(envSnippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    setKeyInput('')
    setResult(null)
    setError(null)
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Activate License"
      data-testid="license-activation-modal"
      footer={
        <ModalFooter align="between">
          <Button variant="ghost" onClick={handleClose}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            onClick={handleValidate}
            disabled={!keyInput.trim() || validating}
            data-testid="license-validate-button"
          >
            {validating ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Validating…</>
            ) : (
              'Validate License'
            )}
          </Button>
        </ModalFooter>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Paste your license key below to validate it. After validation, add the key to your{' '}
          <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-900 text-xs">.env</code>{' '}
          file and restart the server to activate.
        </p>
        <div>
          <label htmlFor="license-key-input" className="text-xs font-medium text-slate-700 dark:text-slate-300">License key</label>
          <textarea
            id="license-key-input"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="grm_lic_eyJ..."
            className="mt-1 w-full px-3 py-2 text-xs font-mono border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent ds-focus-ring"
            rows={4}
          />
        </div>
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-900 dark:text-red-300 text-sm flex gap-2">
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Invalid license</p>
              <p className="text-xs mt-1">{error}</p>
            </div>
          </div>
        )}
        {result && (
          <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 space-y-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">License is valid</p>
                <dl className="mt-2 space-y-1 text-xs">
                  <div className="flex gap-2"><dt className="text-slate-500">Tier:</dt><dd className="font-medium capitalize">{result.tier}</dd></div>
                  {result.org && <div className="flex gap-2"><dt className="text-slate-500">Organization:</dt><dd className="font-medium">{result.org}</dd></div>}
                  {result.email && <div className="flex gap-2"><dt className="text-slate-500">Email:</dt><dd className="font-medium">{result.email}</dd></div>}
                  {result.seats && <div className="flex gap-2"><dt className="text-slate-500">Seats:</dt><dd className="font-medium">{result.seats}</dd></div>}
                  {result.expiresAt && <div className="flex gap-2"><dt className="text-slate-500">Expires:</dt><dd className="font-medium">{new Date(result.expiresAt).toLocaleDateString()}</dd></div>}
                </dl>
              </div>
            </div>
            <div className="pt-3 border-t border-emerald-200 dark:border-emerald-900">
              <p className="text-xs text-slate-700 dark:text-slate-300 mb-2">
                Add to <code className="px-1 py-0.5 rounded bg-white dark:bg-slate-900">.env</code> and restart the server:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-2 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800 overflow-x-auto whitespace-nowrap">{envSnippet}</code>
                <button
                  onClick={handleCopy}
                  className="p-1.5 rounded hover:bg-emerald-100 dark:hover:bg-emerald-950 ds-focus-ring"
                  aria-label="Copy .env snippet"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
