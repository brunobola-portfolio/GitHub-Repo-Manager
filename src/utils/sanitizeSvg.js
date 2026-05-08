/**
 * Minimal SVG sanitizer for AI-generated diagrams (Mermaid output).
 *
 * Mermaid v11+ already runs DOMPurify internally with securityLevel='strict',
 * but its output is still injected into the page via innerHTML. We add a
 * defence-in-depth pass that strips the dangerous element/attr surface so a
 * model that returns SVG with embedded scripts or event handlers cannot trip
 * a DOM XSS even if Mermaid's internal sanitizer misses something.
 *
 * Strips:
 *   - <script>, <foreignObject>, <iframe>, <embed>, <object> elements
 *   - on* event-handler attributes (onclick, onload, onmouseover, …)
 *   - href / xlink:href values that start with javascript:, data:, vbscript:
 */

const DANGEROUS_ELEMENTS = new Set([
    'script', 'foreignobject', 'iframe', 'embed', 'object',
    'animate', 'animatemotion', 'animatetransform', 'set',
])

const DANGEROUS_HREF_PROTOCOLS = /^\s*(javascript|data|vbscript|file):/i

function sanitizeNode(node) {
    if (node.nodeType !== 1) return // ELEMENT_NODE only
    const tag = node.nodeName.toLowerCase()
    if (DANGEROUS_ELEMENTS.has(tag)) {
        node.remove()
        return
    }
    // Strip event handlers and unsafe href targets.
    for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on')) {
            node.removeAttribute(attr.name)
            continue
        }
        if ((name === 'href' || name === 'xlink:href') && DANGEROUS_HREF_PROTOCOLS.test(attr.value)) {
            node.removeAttribute(attr.name)
        }
    }
    // Recurse — Array.from snapshot so removals during iteration are safe.
    for (const child of Array.from(node.childNodes)) sanitizeNode(child)
}

/**
 * Parse an SVG markup string into a sanitized DOM node ready for adoption
 * via `replaceChildren()`. Returns `null` when parsing fails or DOMParser is
 * unavailable so the caller can render an error placeholder.
 *
 * Using a DOM Node (instead of a string + innerHTML) avoids the parser-side
 * script-execution surface and lets the browser construct the SVG without
 * running any HTML parser on the markup again.
 *
 * @param {string} svg
 * @returns {Element | null}
 */
export function parseAndSanitizeSvg(svg) {
    if (typeof svg !== 'string' || !svg) return null
    if (typeof DOMParser === 'undefined') return null
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const root = doc.documentElement
    if (!root || root.nodeName === 'parsererror') return null
    sanitizeNode(root)
    return root
}
