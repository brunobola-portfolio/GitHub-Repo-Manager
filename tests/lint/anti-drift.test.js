import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'

// Locks the layout anti-drift gate in eslint.config.js (spec 2026-06-25
// workstream 3): raw pixel breakpoints and shell-scale max-w caps must be
// flagged, while the token forms must pass. Runs the REAL flat config so the
// test fails if the rule blocks are restructured away.

const eslint = new ESLint({ cwd: process.cwd() })

async function messagesFor(code, filePath) {
    const [result] = await eslint.lintText(code, { filePath })
    return result.messages.map((m) => m.message).join('\n')
}

const component = (className) =>
    `export function Probe() {\n    return <div className="${className}" />\n}\n`

describe('layout anti-drift lint gate', () => {
    it('flags raw min-[Npx] variants in components', async () => {
        const msgs = await messagesFor(component('hidden min-[1340px]:inline'), 'src/components/Probe.jsx')
        expect(msgs).toMatch(/named breakpoints nav:\/wide:\/ultra:/)
    })

    it('flags raw min-[Npx] variants outside components (App-level shell)', async () => {
        const msgs = await messagesFor(component('flex min-[1700px]:flex-nowrap'), 'src/Probe.jsx')
        expect(msgs).toMatch(/named breakpoints nav:\/wide:\/ultra:/)
    })

    it('flags shell-scale max-w caps but not component-scale ones', async () => {
        const shell = await messagesFor(component('max-w-[1920px] mx-auto'), 'src/components/Probe.jsx')
        expect(shell).toMatch(/--layout-max-w/)
        const popover = await messagesFor(component('max-w-[280px]'), 'src/components/Probe.jsx')
        expect(popover).not.toMatch(/--layout-max-w/)
    })

    it('accepts the token forms', async () => {
        const msgs = await messagesFor(
            component('max-w-[var(--layout-max-w)] px-[var(--layout-px)] nav:inline wide:flex-nowrap'),
            'src/components/Probe.jsx',
        )
        expect(msgs).not.toMatch(/named breakpoints|--layout-max-w/)
    })

    it('flags duration-300 but accepts the motion tokens', async () => {
        const raw = await messagesFor(component('transition-all duration-300'), 'src/components/Probe.jsx')
        expect(raw).toMatch(/motion tokens/)
        const tokened = await messagesFor(
            component('transition-all duration-[var(--ds-duration-slow)] hover:duration-[var(--ds-duration)]'),
            'src/components/Probe.jsx',
        )
        expect(tokened).not.toMatch(/motion tokens/)
    })

    it('keeps the theme-spec rules alive in the components block (no rule clobbering)', async () => {
        // The gate lives in TWO blocks; the components one must still carry the
        // pre-existing theme-spec selectors alongside the layout entries.
        const msgs = await messagesFor(component('font-black'), 'src/components/Probe.jsx')
        expect(msgs).toMatch(/font-semibold/)
    })
})
