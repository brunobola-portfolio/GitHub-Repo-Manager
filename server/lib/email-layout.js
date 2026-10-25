// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs Licensed under the Apache License 2.0.

import { escapeHtml as esc, supportFooterParts } from './email-identity.js'

/**
 * One skeleton for every e-mail the app sends, rendered to HTML and plain
 * text from the same spec so the two can never say different things.
 *
 * Mirrors the BolaLabs site's mail (bolalabs-platform convex/lib/emailTemplates.ts)
 * so a customer who gets both sees one company:
 * - Presentation tables and inline styles only. Outlook for Windows (Word's
 *   engine) ignores max-width, flexbox and border-radius, so the fixed width
 *   comes from an `[if mso]` wrapper and the button paints its CELL bgcolor.
 * - System fonts, text at 14px or more. The lime #7fc528 is a fill (the card's
 *   top rule, the button) and never text: as text it is 2.2:1 on white. Accent
 *   text is the site's dark green, 5.6:1.
 * - Dark mode: a <style> repaints where the client honours it (Apple Mail,
 *   Outlook Mac/iOS, Outlook.com via [data-ogsc]/[data-ogsb]); where it is
 *   stripped (Gmail) the inline light styles stand and the client inverts.
 * - No images and no tracking pixels. A self-hosted install would otherwise
 *   make every recipient's mail client fetch from bolalabs.pt.
 *
 * Text segments are `string | { strong } | { code } | { link: { url, label? } }`.
 * Every string is escaped here; callers never pass HTML.
 */

const PAGE = '#f1f5f9'
const CARD = '#ffffff'
const PANEL = '#f8fafc'
const INK = '#0f172a'
const BODY = '#334155'
const MUTED = '#475569'
const ACCENT_TEXT = '#3f7d12'
const LIME = '#7fc528'
const RULE = '#e2e8f0'
const FONT = "'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif"
const MONO = "Consolas,'SF Mono',Menlo,'Courier New',monospace"
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"'

const DARK = {
    page: '#0b1120',
    card: '#111827',
    panel: '#0b1120',
    rule: '#1f2937',
    ink: '#f1f5f9',
    body: '#cbd5e1',
    muted: '#94a3b8',
    accent: '#9bd84a',
}

export const EMAIL_PALETTE = Object.freeze({ PAGE, CARD, PANEL, INK, BODY, MUTED, ACCENT_TEXT, LIME, RULE })

const PRODUCT = 'GitHub Repo Manager'

const txt = (size, line, color, extra = '') =>
    `font-family:${FONT};font-size:${size}px;line-height:${line}px;mso-line-height-rule:exactly;color:${color};${extra}`

function darkRules(prefix, bgPrefix) {
    return [
        `${bgPrefix}.grm-body{background-color:${DARK.page}!important}`,
        `${bgPrefix}.grm-card{background-color:${DARK.card}!important;border-left-color:${DARK.rule}!important;border-right-color:${DARK.rule}!important;border-bottom-color:${DARK.rule}!important}`,
        `${bgPrefix}.grm-panel{background-color:${DARK.panel}!important;border-color:${DARK.rule}!important}`,
        `${prefix}.grm-ink{color:${DARK.ink}!important}`,
        `${prefix}.grm-txt{color:${DARK.body}!important}`,
        `${prefix}.grm-mut{color:${DARK.muted}!important}`,
        `${prefix}.grm-acc{color:${DARK.accent}!important}`,
        `${prefix}.grm-rule{border-color:${DARK.rule}!important}`,
        `${prefix}.grm-btn{color:${INK}!important}`,
    ].join('')
}

const STYLE =
    '<style>' +
    ':root{color-scheme:light dark;supported-color-schemes:light dark}' +
    'body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}' +
    'a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}' +
    '@media (max-width:620px){.grm-outer{padding:16px 8px 24px 8px!important}.grm-pad{padding:28px 22px!important}.grm-foot{padding:20px 22px 0 22px!important}.grm-head{padding:0 22px 16px 22px!important}}' +
    '@media (max-width:480px){.grm-h1{font-size:22px!important;line-height:28px!important}' +
    '.grm-fl{display:block!important;width:auto!important;padding:10px 0 0 0!important}.grm-fv{display:block!important;padding:0 0 2px 0!important;border-top:0!important}' +
    '.grm-btn{display:block!important;text-align:center!important}.grm-btn-t{width:100%!important}}' +
    `@media (prefers-color-scheme:dark){${darkRules('', '')}}` +
    darkRules('[data-ogsc] ', '[data-ogsb] ') +
    '</style>'

function linkLabel(url) {
    return url.replace(/^https?:\/\/|^mailto:/, '').replace(/\?.*$/, '')
}

function segHtml(seg, { color = ACCENT_TEXT, cls = 'grm-acc' } = {}) {
    if (typeof seg === 'string') return esc(seg)
    if (seg?.strong != null) return `<strong class="grm-ink" style="color:${INK};">${esc(seg.strong)}</strong>`
    if (seg?.code != null) return `<span style="font-family:${MONO};font-size:14px;">${esc(seg.code)}</span>`
    if (seg?.link) {
        const { url, label = linkLabel(url) } = seg.link
        const style = `color:${color};text-decoration:underline;word-break:break-word;`
        return `<a class="${cls}" href="${esc(url)}" target="_blank" style="${style}"><span class="${cls}" style="${style}">${esc(label)}</span></a>`
    }
    return ''
}

function segText(seg) {
    if (typeof seg === 'string') return seg
    if (seg?.strong != null) return seg.strong
    if (seg?.code != null) return seg.code
    if (seg?.link) {
        const { url, label } = seg.link
        const bare = url.replace(/^mailto:/, '')
        return label && label !== bare && label !== linkLabel(url) ? `${label} (${bare})` : bare
    }
    return ''
}

const paraOf = (p) => (Array.isArray(p) ? p : [p])
const paraHtml = (p, opts) => paraOf(p).map((s) => segHtml(s, opts)).join('')
const paraText = (p) => paraOf(p).map(segText).join('')

function factsHtml(facts) {
    const rows = facts.map((f, i) => {
        const top = i === 0 ? '' : `border-top:1px solid ${RULE};`
        return `<tr><td class="grm-mut grm-fl grm-rule" valign="top" width="128" style="width:128px;padding:10px 16px 10px 0;${top}${txt(14, 20, MUTED)}">${esc(f.label)}</td>` +
            `<td class="grm-ink grm-fv grm-rule" valign="top" style="padding:10px 0;${top}${txt(14, 20, INK)}word-break:break-word;">${paraHtml(f.value)}</td></tr>`
    }).join('')
    return panel(`<td style="padding:6px 18px;"><table ${TABLE} width="100%" style="border-collapse:collapse;">${rows}</table></td>`)
}

function itemsHtml(items, empty) {
    if (!items.length) return `<tr><td class="grm-mut" style="padding:0 0 18px 0;${txt(14, 21, MUTED)}">${esc(empty ?? 'Nothing here.')}</td></tr>`
    const rows = items.map((it, i) =>
        `<tr><td class="grm-rule" style="padding:12px 0;${i === 0 ? '' : `border-top:1px solid ${RULE};`}">` +
        `<div class="grm-ink" style="${txt(15, 22, INK, 'font-weight:600;')}word-break:break-word;">${paraHtml(it.title)}</div>` +
        (it.meta ? `<div class="grm-mut" style="${txt(14, 20, MUTED)}word-break:break-word;">${paraHtml(it.meta)}</div>` : '') +
        '</td></tr>').join('')
    return `${panel(`<td style="padding:4px 18px;"><table ${TABLE} width="100%" style="border-collapse:collapse;">${rows}</table></td>`)}<tr><td style="padding:0 0 18px 0;font-size:0;line-height:0;">&nbsp;</td></tr>`
}

function panel(inner) {
    return `<tr><td style="padding:4px 0 14px 0;"><table ${TABLE} width="100%" class="grm-panel" bgcolor="${PANEL}" style="border-collapse:separate;background-color:${PANEL};border:1px solid ${RULE};border-radius:10px;"><tr>${inner}</tr></table></td></tr>`
}

function blockHtml(b) {
    if (b.p != null) return `<tr><td class="grm-txt" style="padding:0 0 14px 0;${txt(16, 25, BODY)}">${paraHtml(b.p)}</td></tr>`
    if (b.h != null) return `<tr><td class="grm-ink" style="padding:12px 0 8px 0;${txt(17, 24, INK, 'font-weight:700;')}"><h2 style="margin:0;font:inherit;color:inherit;">${esc(b.h)}</h2></td></tr>`
    if (b.secret != null) {
        // user-select:all so one tap selects the whole key on a phone.
        return panel(`<td class="grm-ink" style="padding:16px 18px;font-family:${MONO};font-size:14px;line-height:21px;mso-line-height-rule:exactly;color:${INK};word-break:break-all;-webkit-user-select:all;user-select:all;">${esc(b.secret)}</td>`)
    }
    if (b.facts) return factsHtml(b.facts)
    if (b.items) return itemsHtml(b.items, b.empty)
    if (b.button) {
        return `<tr><td style="padding:14px 0 18px 0;"><table ${TABLE} class="grm-btn-t" style="border-collapse:separate;"><tr>` +
            `<td align="center" bgcolor="${LIME}" style="background-color:${LIME};border-radius:8px;mso-padding-alt:14px 28px;">` +
            `<a class="grm-btn" href="${esc(b.button.url)}" target="_blank" style="display:inline-block;padding:14px 28px;${txt(16, 20, INK, 'font-weight:700;text-decoration:none;border-radius:8px;')}">${esc(b.button.label)}</a>` +
            '</td></tr></table></td></tr>'
    }
    if (b.note != null) return `<tr><td class="grm-mut" style="padding:0 0 12px 0;${txt(14, 21, MUTED)}">${paraHtml(b.note)}</td></tr>`
    return ''
}

function blockText(b) {
    if (b.p != null) return [paraText(b.p), '']
    if (b.h != null) return [b.h, '-'.repeat(Math.min(60, b.h.length))]
    if (b.secret != null) return [b.secret, '']
    if (b.facts) return [...b.facts.map((f) => `${f.label}: ${paraText(f.value)}`), '']
    if (b.items) {
        if (!b.items.length) return [`  ${b.empty ?? 'Nothing here.'}`, '']
        return [...b.items.flatMap((it) => [`  - ${paraText(it.title)}`, ...(it.meta ? [`    ${paraText(it.meta)}`] : [])]), '']
    }
    if (b.button) return [`${b.button.label}: ${b.button.url}`, '']
    if (b.note != null) return [paraText(b.note), '']
    return []
}

/**
 * @param {object} spec
 * @param {string} spec.subject
 * @param {string} spec.preheader   inbox preview line; says what happened
 * @param {string} [spec.eyebrow]
 * @param {string} spec.heading
 * @param {Array<object>} spec.blocks
 * @param {Array<string|object>} spec.why  why the recipient got this mail
 * @param {string|false} [spec.help]       support-line lead, false to omit
 * @returns {{ html: string, text: string }}
 */
export function renderEmail({ subject, preheader, eyebrow, heading, blocks = [], why, help = 'Need help?' }) {
    const support = help === false ? [] : supportFooterParts(help)
    // Pads the inbox preview so it does not run on into the body after the preheader.
    const spacer = '&#847;&zwnj;&nbsp;'.repeat(60)

    const body = []
    if (eyebrow) body.push(`<tr><td class="grm-acc" style="padding:0 0 10px 0;${txt(14, 20, ACCENT_TEXT, 'font-weight:700;')}">${esc(eyebrow)}</td></tr>`)
    body.push(`<tr><td class="grm-ink grm-h1" style="padding:0 0 14px 0;${txt(24, 31, INK, 'font-weight:700;letter-spacing:-0.3px;')}"><h1 style="margin:0;font:inherit;color:inherit;letter-spacing:inherit;">${esc(heading)}</h1></td></tr>`)
    for (const b of blocks) body.push(blockHtml(b))

    const muted = { color: MUTED, cls: 'grm-mut' }
    const footer = [
        `<tr><td class="grm-mut" style="padding:0 0 6px 0;${txt(14, 21, MUTED)}"><strong class="grm-ink" style="color:${INK};">${PRODUCT}</strong>&nbsp;&middot;&nbsp;a BolaLabs product</td></tr>`,
        `<tr><td class="grm-mut" style="padding:0 0 6px 0;${txt(14, 21, MUTED)}">${paraHtml(why, muted)}</td></tr>`,
        support.length ? `<tr><td class="grm-mut" style="padding:0;${txt(14, 21, MUTED)}">${paraHtml(support, muted)}</td></tr>` : '',
    ].join('')

    const html = [
        '<!DOCTYPE html>',
        '<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
        '<meta name="x-apple-disable-message-reformatting">',
        '<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">',
        '<meta name="color-scheme" content="light dark">',
        '<meta name="supported-color-schemes" content="light dark">',
        `<title>${esc(subject)}</title>`,
        "<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>body,table,td,a,span,h1,h2{font-family:'Segoe UI',Arial,sans-serif!important}</style><![endif]-->",
        STYLE,
        '</head>',
        `<body class="grm-body" style="margin:0;padding:0;background-color:${PAGE};">`,
        `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${PAGE};">${esc(preheader)}${spacer}</div>`,
        `<table ${TABLE} width="100%" class="grm-body" bgcolor="${PAGE}" style="border-collapse:collapse;background-color:${PAGE};">`,
        '<tr><td class="grm-outer" align="center" style="padding:32px 12px 40px 12px;">',
        `<!--[if mso]><table ${TABLE} width="560" align="center"><tr><td><![endif]-->`,
        `<table ${TABLE} width="100%" style="border-collapse:collapse;max-width:560px;">`,
        `<tr><td class="grm-head grm-ink" style="padding:0 32px 18px 32px;${txt(18, 22, INK, 'font-weight:700;letter-spacing:-0.2px;')}">${PRODUCT}<br><span class="grm-mut" style="${txt(14, 18, MUTED, 'font-weight:400;letter-spacing:0;')}">by BolaLabs</span></td></tr>`,
        `<tr><td class="grm-card grm-pad" bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${RULE};border-top:4px solid ${LIME};border-radius:12px;padding:36px 36px 22px 36px;">`,
        `<table ${TABLE} width="100%" style="border-collapse:collapse;">${body.join('')}</table>`,
        '</td></tr>',
        `<tr><td class="grm-foot" style="padding:24px 32px 0 32px;"><table ${TABLE} width="100%" style="border-collapse:collapse;">${footer}</table></td></tr>`,
        '</table>',
        '<!--[if mso]></td></tr></table><![endif]-->',
        '</td></tr></table>',
        '</body></html>',
    ].join('\n')

    const lines = []
    if (eyebrow) lines.push(eyebrow)
    lines.push(heading, '='.repeat(Math.min(60, heading.length)), '')
    for (const b of blocks) lines.push(...blockText(b))
    lines.push('--', `${PRODUCT}, a BolaLabs product`, paraText(why))
    if (support.length) lines.push(paraText(support))

    return { html, text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() }
}
