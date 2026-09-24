import { describe, it, expect } from 'vitest'
import { mermaidInitConfig } from '../../src/utils/mermaidConfig'

describe('mermaidInitConfig', () => {
    it('keeps the security invariants every diagram surface relies on', () => {
        for (const theme of ['dark', 'default']) {
            const cfg = mermaidInitConfig(theme)
            expect(cfg.securityLevel).toBe('strict')
            expect(cfg.htmlLabels).toBe(false)
            expect(cfg.flowchart.htmlLabels).toBe(false)
            expect(cfg.startOnLoad).toBe(false)
        }
    })

    it('uses the base theme with explicit variables instead of the stock purple themes', () => {
        const light = mermaidInitConfig('default')
        const dark = mermaidInitConfig('dark')
        expect(light.theme).toBe('base')
        expect(dark.theme).toBe('base')
        expect(light.darkMode).toBe(false)
        expect(dark.darkMode).toBe(true)
        expect(light.themeVariables.primaryBorderColor).toBe('#55831b')
        expect(dark.themeVariables.primaryBorderColor).toBe('#6ba522')
        expect(light.themeVariables.background).toBe('#ffffff')
        expect(dark.themeVariables.background).toBe('#0f172a')
    })

    it('sets the variables mermaid 11+ reads for ER rows and gitGraph lanes', () => {
        const dark = mermaidInitConfig('dark').themeVariables
        const light = mermaidInitConfig('default').themeVariables
        // Dark ER rows must be dark, or the light attribute text is unreadable.
        expect(dark.rowOdd).toBe('#1e293b')
        expect(dark.rowEven).toBe('#111a2e')
        expect(light.rowOdd).toBe('#ffffff')
        // Every lane is defined and none is the canvas colour it would vanish into.
        for (const [vars, canvas] of [[dark, '#0f172a'], [light, '#ffffff']]) {
            for (let i = 0; i < 8; i++) {
                expect(vars[`git${i}`]).toMatch(/^#[0-9a-f]{6}$/)
                expect(vars[`git${i}`]).not.toBe(canvas)
                expect(vars[`gitBranchLabel${i}`]).toMatch(/^#[0-9a-f]{6}$/)
            }
        }
        expect(dark.git0).toBe('#6ba522')
        expect(light.git0).toBe('#55831b')
    })

    it('never carries a retired palette hue', () => {
        const hex = JSON.stringify(mermaidInitConfig('dark')) + JSON.stringify(mermaidInitConfig('default'))
        // Mermaid's defaults: #ECECFF node fill, #9370DB border, #333 lines.
        expect(hex.toLowerCase()).not.toMatch(/#ececff|#9370db|#333\b/)
    })
})
