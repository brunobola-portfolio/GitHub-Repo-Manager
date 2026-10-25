import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notifyFailure } from '../mint-failure-notify.js'

describe('mint-failure-notify', () => {
  let fetchMock, originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('sends an alert to Resend with run URL and event type', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'notify-001' }),
    })

    await notifyFailure({
      resendApiKey: 'test-key',
      fromEmail: 'BolaLabs Licences <licencas@bolalabs.pt>',
      toEmail: 'bruno@bolalabs.pt',
      runId: '1234567890',
      repo: 'brunobola-portfolio/GitHub-Repo-Manager',
      eventName: 'workflow_dispatch',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.subject).toMatch(/failed|failure/i)
    expect(body.text).toContain('1234567890')
    expect(body.text).toContain('brunobola-portfolio/GitHub-Repo-Manager')
    expect(body.text).toContain('workflow_dispatch')
    // Must NOT contain any license material
    expect(body.text).not.toMatch(/grm_lic_/)
    expect(body.text).not.toMatch(/private_pem/i)
  })

  it('defaults to the licencas@ box (licenses@ does not exist) and marks the mail as automated', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'n' }) })

    await notifyFailure({ resendApiKey: 'k', runId: '77', repo: 'o/r', eventName: 'repository_dispatch' })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.from).toBe('BolaLabs Licences <licencas@bolalabs.pt>')
    expect(body.to).toEqual(['bruno@bolalabs.pt'])
    expect(body.headers).toEqual({ 'Auto-Submitted': 'auto-generated' })
    expect(init.headers['Idempotency-Key']).toBe('mint-failure-77')
  })

  it('keeps the subject on one line', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'n' }) })
    await notifyFailure({ resendApiKey: 'k', runId: '1', repo: 'o/r', eventName: 'x\r\nBcc: a@b.c' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.subject).not.toMatch(/[\r\n]/)
  })

  it('is a no-op if resendApiKey is missing (graceful degradation)', async () => {
    // If Resend is unconfigured, the failure notifier should exit silently
    // rather than throwing — it's already a failure handler.
    await expect(notifyFailure({
      resendApiKey: '',
      fromEmail: 'BolaLabs Licences <licencas@bolalabs.pt>',
      toEmail: 'bruno@bolalabs.pt',
      runId: '1', repo: 'r', eventName: 'e',
    })).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
