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

    it('never carries a retired palette hue', () => {
        const hex = JSON.stringify(mermaidInitConfig('dark')) + JSON.stringify(mermaidInitConfig('default'))
        // Mermaid's defaults: #ECECFF node fill, #9370DB border, #333 lines.
        expect(hex.toLowerCase()).not.toMatch(/#ececff|#9370db|#333\b/)
    })
})
