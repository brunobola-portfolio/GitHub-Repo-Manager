import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let mockedModal

vi.mock('@/hooks/useModal', () => ({
	useModal: () => mockedModal,
}))

const { useDangerAction } = await import('@/hooks/useDangerAction')

const mkModal = () => ({
	openModalWithData: vi.fn(),
	closeModal: vi.fn(),
	get capturedConfig() {
		return this.openModalWithData.mock.calls[0]?.[1]
	},
})

describe('useDangerAction', () => {
	beforeEach(() => { mockedModal = mkModal() })

	it('run() opens showConfirm with the documented config', async () => {
		const onConfirm = vi.fn(async () => { })
		const { result } = renderHook(() => useDangerAction({
			title: 'Delete?',
			message: 'Are you sure?',
			variant: 'danger',
			requiresInput: 'delete me',
			onConfirm,
		}))

		await act(async () => { result.current.run() })

		const cfg = mockedModal.capturedConfig
		expect(cfg.title).toBe('Delete?')
		expect(cfg.message).toBe('Are you sure?')
		expect(cfg.variant).toBe('danger')
		expect(cfg.requiresInput).toBe('delete me')
		expect(typeof cfg.onConfirm).toBe('function')
		expect(typeof cfg.onClose).toBe('function')
	})

	it('confirm path resolves the run() Promise as true', async () => {
		const onConfirm = vi.fn(async () => { })
		const { result } = renderHook(() => useDangerAction({
			title: 't', message: 'm', variant: 'danger', onConfirm,
		}))

		let runPromise
		await act(async () => { runPromise = result.current.run() })
		const cfg = mockedModal.capturedConfig
		await act(async () => { await cfg.onConfirm() })

		const ok = await runPromise
		expect(ok).toBe(true)
		expect(onConfirm).toHaveBeenCalledOnce()
		expect(mockedModal.closeModal).toHaveBeenCalledWith('showConfirm')
	})

	it('cancel path resolves run() as false; onConfirm NOT called', async () => {
		const onConfirm = vi.fn()
		const { result } = renderHook(() => useDangerAction({
			title: 't', message: 'm', variant: 'warning', onConfirm,
		}))

		let runPromise
		await act(async () => { runPromise = result.current.run() })
		const cfg = mockedModal.capturedConfig
		await act(async () => { cfg.onClose() })

		const ok = await runPromise
		expect(ok).toBe(false)
		expect(onConfirm).not.toHaveBeenCalled()
	})

	it('onConfirm throwing rejects the run() Promise with the same error', async () => {
		const { result } = renderHook(() => useDangerAction({
			title: 't', message: 'm', variant: 'danger',
			onConfirm: async () => { throw new Error('boom') },
		}))

		let runPromise
		await act(async () => {
			runPromise = result.current.run()
			// Attach a no-op catch to prevent unhandled-rejection noise; the
			// real assertion uses .rejects below.
			runPromise.catch(() => { })
		})
		const cfg = mockedModal.capturedConfig
		await act(async () => { await cfg.onConfirm() })

		await expect(runPromise).rejects.toThrow('boom')
		expect(mockedModal.closeModal).toHaveBeenCalledWith('showConfirm')
	})

	it('idempotent settle: double onConfirm only resolves once', async () => {
		const onConfirm = vi.fn(async () => { })
		const { result } = renderHook(() => useDangerAction({
			title: 't', message: 'm', variant: 'danger', onConfirm,
		}))

		let runPromise
		await act(async () => { runPromise = result.current.run() })
		const cfg = mockedModal.capturedConfig
		await act(async () => { await cfg.onConfirm(); await cfg.onConfirm() })

		const ok = await runPromise
		expect(ok).toBe(true)
		// onConfirm callback invoked twice (modal could fire twice) but Promise settled once.
		expect(onConfirm).toHaveBeenCalledTimes(2)
	})

	it('default variant is danger when omitted', async () => {
		const { result } = renderHook(() => useDangerAction({
			title: 't', message: 'm', onConfirm: () => { },
		}))
		await act(async () => { result.current.run() })
		expect(mockedModal.capturedConfig.variant).toBe('danger')
	})
})
