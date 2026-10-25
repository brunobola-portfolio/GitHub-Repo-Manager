// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs Licensed under the Apache License 2.0.

/**
 * Who an outbound email is from, and where replies go.
 *
 * Two streams:
 *   - `system`   — sign-in, team, retention and digest notices. From EMAIL_FROM.
 *   - `licences` — licence keys. From EMAIL_FROM_LICENCES when set.
 *
 * Replies go to EMAIL_REPLY_TO. Every automated sender address is a no-reply
 * box, so a customer who presses Reply on a licence email must land on a desk
 * that answers — without a Reply-To they hit a forwarder or a 550.
 *
 * The hosted deployment sends from bolalabs.pt, whose support desk and licence
 * box are known; those become the defaults only on that domain. A self-hosted
 * install on any other domain gets no Reply-To and one sender unless its
 * operator configures them, so its users are never routed to the upstream
 * vendor.
 */

const HOUSE_DOMAIN = 'bolalabs.pt'
const HOUSE_DEFAULTS = {
    systemName: 'BolaLabs RepoManager',
    licences: { name: 'BolaLabs Licences', address: `licencas@${HOUSE_DOMAIN}` },
    replyTo: `suporte@${HOUSE_DOMAIN}`,
    // The BolaLabs support desk. The dashboard sends a signed-out visitor
    // through sign-in and back here (`next`), straight into a new request.
    supportUrl: `https://${HOUSE_DOMAIN}/en/dashboard?view=support&new=1`,
}
const GENERIC_SYSTEM_NAME = 'RepoManager'

const ADDRESS_SHAPE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/

function env(name) {
    const value = process.env[name]?.trim()
    return value ? value : undefined
}

/**
 * Split `Name <addr>` (or a bare address) into its parts. Returns null when
 * the address part is not a plausible mailbox.
 */
export function parseMailbox(raw) {
    if (!raw) return null
    const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw)
    const name = match ? match[1].trim() : ''
    const address = (match ? match[2] : raw).trim()
    if (!ADDRESS_SHAPE.test(address)) return null
    return { name, address }
}

function domainOf(address) {
    return address.split('@')[1]?.toLowerCase() ?? ''
}

/** Display name safe for a header: no quotes, angle brackets, separators or line breaks. */
function cleanName(name) {
    return String(name ?? '').replace(/[<>"\\\r\n,;]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim()
}

export function formatMailbox(name, address) {
    const clean = cleanName(name)
    return clean ? `"${clean}" <${address}>` : address
}

/**
 * Header-safe single line: CR/LF and tabs collapse to spaces. Resend builds the
 * MIME message itself, but a subject carrying a team name or repository text
 * must still never be able to start a new header line.
 */
export function headerSafe(value, max = 200) {
    const flat = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
    return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/**
 * Resolve the sender for a stream.
 *
 * @param {'system'|'licences'} [stream='system']
 * @returns {{ from: string, address: string, replyTo?: string, warning?: string } | null}
 *   null when EMAIL_FROM is missing or malformed.
 */
export function resolveSender(stream = 'system') {
    const base = parseMailbox(env('EMAIL_FROM'))
    if (!base) return null
    const domain = domainOf(base.address)
    const house = domain === HOUSE_DOMAIN

    let name = base.name || (house ? HOUSE_DEFAULTS.systemName : GENERIC_SYSTEM_NAME)
    let address = base.address
    let warning

    if (stream === 'licences') {
        const override = env('EMAIL_FROM_LICENCES')
        const parsed = override ? parseMailbox(override) : null
        if (override && parsed && domainOf(parsed.address) === domain) {
            address = parsed.address
            if (parsed.name) name = parsed.name
            else if (house) name = HOUSE_DEFAULTS.licences.name
        } else if (override) {
            // A sender on another domain fails DMARC alignment at the provider;
            // fall back to EMAIL_FROM rather than lose a licence key.
            warning = `EMAIL_FROM_LICENCES ignored (must be an address on ${domain}); sent from EMAIL_FROM`
        } else if (house) {
            address = HOUSE_DEFAULTS.licences.address
            name = HOUSE_DEFAULTS.licences.name
        }
    }

    const replyRaw = env('EMAIL_REPLY_TO')
    let replyTo
    if (replyRaw && replyRaw.toLowerCase() !== 'none') {
        const parsed = parseMailbox(replyRaw)
        if (parsed) replyTo = parsed.address
        else warning = 'EMAIL_REPLY_TO ignored (not an email address)'
    } else if (!replyRaw && house) {
        replyTo = HOUSE_DEFAULTS.replyTo
    }

    return { from: formatMailbox(name, address), address, ...(replyTo ? { replyTo } : {}), ...(warning ? { warning } : {}) }
}

/**
 * Where a recipient asks for help, for the footer of every email: the support
 * desk URL (EMAIL_SUPPORT_URL) and the Reply-To mailbox. On the house domain
 * both default to the BolaLabs desk; elsewhere they are whatever the operator
 * configured, or absent.
 *
 * @returns {{ url?: string, email?: string }}
 */
export function supportContact() {
    const sender = resolveSender('system')
    const house = sender ? domainOf(sender.address) === HOUSE_DOMAIN : false
    const configuredUrl = env('EMAIL_SUPPORT_URL')
    let url
    if (configuredUrl && /^https:\/\/[^\s"<>]+$/.test(configuredUrl)) url = configuredUrl
    else if (!configuredUrl && house) url = HOUSE_DEFAULTS.supportUrl
    return { ...(url ? { url } : {}), ...(sender?.replyTo ? { email: sender.replyTo } : {}) }
}

/**
 * Licences are sold only by the publisher, whoever hosts the instance, so
 * "buy a licence" may point upstream from any install. Support may not.
 */
export const PUBLISHER_LICENCE_URL = `https://${HOUSE_DOMAIN}/en/repomanager`
const HOUSE_SALES_URL = `https://${HOUSE_DOMAIN}/en/contact?topic=repomanager`

/**
 * Contacts the web app may show, sent to the browser in the shell (see
 * spa-shell.js renderShell). Same rule as the email footer: the BolaLabs
 * desk only on the house domain, otherwise only what the operator set
 * (EMAIL_SUPPORT_URL / EMAIL_REPLY_TO). Self-hosted builds used to bake
 * the maintainer's personal address into every "contact support" link.
 *
 * @returns {{ url?: string, email?: string, salesUrl: string }}
 */
export function publicSupport() {
    const sender = resolveSender('system')
    const house = sender ? domainOf(sender.address) === HOUSE_DOMAIN : false
    const { url, email } = supportContact()
    const deskUrl = url && house && url === HOUSE_DEFAULTS.supportUrl
        ? `${url}&product=repomanager`
        : url
    return {
        ...(deskUrl ? { url: deskUrl } : {}),
        ...(email ? { email } : {}),
        salesUrl: house ? HOUSE_SALES_URL : PUBLISHER_LICENCE_URL,
    }
}

/** Headers every automated message carries (RFC 3834): auto-responders must not answer it. */
export const AUTOMATED_HEADERS = Object.freeze({ 'Auto-Submitted': 'auto-generated' })

const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Escape text for an HTML email body. Team names and usernames are user input. */
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ENTITIES[c])
}

/**
 * The "need help?" line as email-layout.js text segments. Empty when the
 * operator configured neither a desk URL nor a Reply-To: saying "reply to
 * this email" from a no-reply box is how a customer's question ends in a
 * bounce.
 *
 * @param {string} [lead='Need help?']
 * @returns {Array<string|{ link: { url: string, label: string } }>}
 */
export function supportFooterParts(lead = 'Need help?') {
    const { url, email } = supportContact()
    if (!url && !email) return []
    const parts = [`${lead} `]
    if (url) parts.push('Open a support request at ', { link: { url, label: url.replace(/^https:\/\/|\?.*$/g, '') } })
    if (email) parts.push(`${url ? ' or reply' : 'Reply'} to this email (it reaches `, { link: { url: `mailto:${email}`, label: email } }, ')')
    parts.push('.')
    return parts
}
