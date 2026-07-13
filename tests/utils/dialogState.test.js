import { describe, it, expect, afterEach } from 'vitest'
import { isBlockingDialogOpen } from '../../src/utils/dialogState'

function mount(attrs) {
    const el = document.createElement('div')
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
    document.body.appendChild(el)
    return el
}

describe('isBlockingDialogOpen', () => {
    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('returns false when no dialog is in the DOM', () => {
        expect(isBlockingDialogOpen()).toBe(false)
    })

    it('returns true for [role="dialog"] with no aria-modal attribute', () => {
        // ConfirmModal-style dialogs may omit aria-modal; treat them as blocking.
        mount({ role: 'dialog' })
        expect(isBlockingDialogOpen()).toBe(true)
    })

    it('returns true for [aria-modal="true"] without role="dialog"', () => {
        mount({ 'aria-modal': 'true' })
        expect(isBlockingDialogOpen()).toBe(true)
    })

    it('returns true for [role="dialog"][aria-modal="true"]', () => {
        mount({ role: 'dialog', 'aria-modal': 'true' })
        expect(isBlockingDialogOpen()).toBe(true)
    })

    it('returns false for an explicitly non-modal [role="dialog"][aria-modal="false"]', () => {
        // e.g. the Header system-health popover — open on top of any page,
        // but the page underneath stays interactive.
        mount({ role: 'dialog', 'aria-modal': 'false' })
        expect(isBlockingDialogOpen()).toBe(false)
    })

    it('returns true when a non-modal popover AND a blocking dialog are both open', () => {
        mount({ role: 'dialog', 'aria-modal': 'false' })
        mount({ role: 'dialog', 'aria-modal': 'true' })
        expect(isBlockingDialogOpen()).toBe(true)
    })
})
