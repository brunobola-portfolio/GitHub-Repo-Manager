import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openConfirm } from '../../src/utils/openConfirm'

const mkModal = () => ({
  openModalWithData: vi.fn(),
  closeModal: vi.fn(),
  get cfg() {
    return this.openModalWithData.mock.calls[0]?.[1]
  },
})

describe('openConfirm', () => {
  let modal
  beforeEach(() => { modal = mkModal() })

  it('opens showConfirm spreading the display config (minus onConfirm)', () => {
    openConfirm(modal, { title: 'T', message: 'M', variant: 'danger', requiresInput: 'yes', onConfirm: () => {} })
    expect(modal.openModalWithData).toHaveBeenCalledWith('showConfirm', expect.objectContaining({
      title: 'T', message: 'M', variant: 'danger', requiresInput: 'yes',
    }))
    const cfg = modal.cfg
    expect(typeof cfg.onConfirm).toBe('function')
    expect(typeof cfg.onClose).toBe('function')
  })

  describe('pure gate (no onConfirm)', () => {
    it('resolves true on confirm and closes the modal', async () => {
      const p = openConfirm(modal, { title: 't', message: 'm' })
      await modal.cfg.onConfirm()
      await expect(p).resolves.toBe(true)
      expect(modal.closeModal).toHaveBeenCalledWith('showConfirm')
    })

    it('resolves false on dismiss', async () => {
      const p = openConfirm(modal, { title: 't', message: 'm' })
      modal.cfg.onClose()
      await expect(p).resolves.toBe(false)
    })
  })

  describe('embedded action (onConfirm present)', () => {
    it('runs onConfirm then resolves true', async () => {
      const onConfirm = vi.fn(async () => {})
      const p = openConfirm(modal, { title: 't', message: 'm', onConfirm })
      await modal.cfg.onConfirm()
      await expect(p).resolves.toBe(true)
      expect(onConfirm).toHaveBeenCalledOnce()
      expect(modal.closeModal).toHaveBeenCalledWith('showConfirm')
    })

    it('rejects with the same error when onConfirm throws (and still closes)', async () => {
      const p = openConfirm(modal, { title: 't', message: 'm', onConfirm: async () => { throw new Error('boom') } })
      p.catch(() => {}) // silence unhandled-rejection noise before the assertion
      await modal.cfg.onConfirm()
      await expect(p).rejects.toThrow('boom')
      expect(modal.closeModal).toHaveBeenCalledWith('showConfirm')
    })

    it('does NOT call onConfirm on dismiss', async () => {
      const onConfirm = vi.fn()
      const p = openConfirm(modal, { title: 't', message: 'm', onConfirm })
      modal.cfg.onClose()
      await expect(p).resolves.toBe(false)
      expect(onConfirm).not.toHaveBeenCalled()
    })
  })

  it('settles once even if confirm fires twice', async () => {
    const onConfirm = vi.fn(async () => {})
    const p = openConfirm(modal, { title: 't', message: 'm', onConfirm })
    await modal.cfg.onConfirm()
    await modal.cfg.onConfirm()
    await expect(p).resolves.toBe(true)
    // The modal handler ran twice, but the Promise settled exactly once.
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })
})
