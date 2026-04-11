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
      fromEmail: 'licenses@bolalabs.pt',
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

  it('is a no-op if resendApiKey is missing (graceful degradation)', async () => {
    // If Resend is unconfigured, the failure notifier should exit silently
    // rather than throwing — it's already a failure handler.
    await expect(notifyFailure({
      resendApiKey: '',
      fromEmail: 'licenses@bolalabs.pt',
      toEmail: 'bruno@bolalabs.pt',
      runId: '1', repo: 'r', eventName: 'e',
    })).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
