/*
 * CSP compatibility gate for the app shell.
 *
 * In production server/index.js sends `script-src 'self'` with no nonce and
 * no hash. Any inline <script> in index.html is therefore blocked by the
 * browser — silently, in production only. That is invisible in dev (CSP is
 * off), invisible in unit tests, and invisible in the mock-mode e2e run,
 * which is exactly how the theme flash-prevention script shipped broken:
 * every dark-mode page load flashed white on the hosted deployment.
 *
 * Anything that must run before React does belongs in public/ as an external
 * file (Vite copies public/ into dist/ verbatim).
 */
import { readFileSync, existsSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const SHELL = 'index.html'

describe('app shell is CSP-safe under script-src \'self\'', () => {
  const html = readFileSync(SHELL, 'utf8')

  it('has no inline <script> body', () => {
    // Matches <script …>BODY</script> and captures BODY. src-only tags have an
    // empty body and are fine; JSON-LD and importmap blocks would also be
    // caught here, which is correct — both need a CSP allowance too.
    // Quoted spans are skipped so a `>` inside an attribute cannot end the tag
    // early, and the closing tag allows whitespace — HTML treats `</script >`
    // as a valid close, so a pattern requiring `</script>` exactly would read
    // the whole rest of the file as one body and miss what follows it.
    const inline = [...html.matchAll(/<script(?=[\s/>])(?:"[^"]*"|'[^']*'|[^"'>])*>([\s\S]*?)<\/script\s*>/gi)]
      .map((m) => m[1].trim())
      .filter(Boolean)

    expect(inline, `Inline script(s) in ${SHELL} would be blocked in production. Move them to public/ and reference by src.`).toEqual([])
  })

  it('has no inline event handler attributes', () => {
    // onclick="…" and friends need 'unsafe-inline' just as much as a script
    // block does (and `script-src-attr 'none'` blocks them outright).
    //
    // Enumerated, not /\son[a-z]+=/ — that shape also matched perfectly
    // innocent attributes like `once=` and `onlyif=`, which would have failed
    // the build for nothing.
    const HANDLERS = [
      'onclick', 'ondblclick', 'onload', 'onerror', 'onmouseover', 'onmouseout',
      'onmousedown', 'onmouseup', 'onfocus', 'onblur', 'onchange', 'oninput',
      'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress', 'ontoggle', 'onscroll',
      'onanimationend', 'ontransitionend', 'onbeforeunload', 'onpointerdown',
    ]
    for (const handler of HANDLERS) {
      expect(html, `${handler}= is an inline handler`).not.toMatch(new RegExp(`\\s${handler}\\s*=`, 'i'))
    }
  })

  it('every script src it does load is same-origin', () => {
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
    expect(srcs.length).toBeGreaterThan(0)
    for (const src of srcs) {
      expect(src, `${src} is cross-origin; script-src 'self' would block it`).toMatch(/^\/(?!\/)/)
    }
  })

  it('the theme bootstrap it references actually exists in public/', () => {
    // A dangling src is a 404 in prod and a silent loss of the dark-mode
    // flash guard — the same symptom the inline version had.
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
    for (const src of srcs) {
      // /src/* is Vite's dev entry, resolved by the bundler, not a public asset.
      if (src.startsWith('/src/')) continue
      expect(existsSync(`public${src}`), `${src} is referenced by ${SHELL} but missing from public/`).toBe(true)
    }
  })
})
