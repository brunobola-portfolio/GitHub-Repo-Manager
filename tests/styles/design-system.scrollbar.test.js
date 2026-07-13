import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const __dirname = import.meta.dirname
const designSystemCss = readFileSync(resolve(__dirname, '../../src/design-system.css'), 'utf8')
const indexCss = readFileSync(resolve(__dirname, '../../src/index.css'), 'utf8')

describe('.ds-scrollbar — single canonical definition (no unlayered/@layer duplicate)', () => {
  it('index.css no longer defines .ds-scrollbar (was dead code, shadowed by the unlayered design-system.css rule)', () => {
    // Line-anchored: index.css keeps unrelated `html` / `*` scrollbar defaults
    // whose docblocks mention ".ds-scrollbar" in passing — only an actual
    // selector (line starting with the class) would mean the rule came back.
    expect(indexCss).not.toMatch(/^\s*\.ds-scrollbar\b/m)
  })

  it('design-system.css defines the .ds-scrollbar base rule exactly once', () => {
    const baseRuleMatches = designSystemCss.match(/^\.ds-scrollbar\s*\{/gm) || []
    expect(baseRuleMatches).toHaveLength(1)
  })

  it('adopted the hover-reveal treatment (transparent at rest, revealed on hover)', () => {
    expect(designSystemCss).toMatch(/\.ds-scrollbar\s*\{[^}]*scrollbar-color:\s*transparent transparent/)
    expect(designSystemCss).toMatch(/\.ds-scrollbar:hover\s*\{/)
  })
})
