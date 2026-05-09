// Inline rehype plugin: assign id to <h1>-<h6> from text content.
// Intentionally avoids the `rehype-slug` dependency for a 12-line transform.

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

function slugify(text) {
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 80)
}

function visit(node, fn) {
    fn(node)
    if (node.children) for (const c of node.children) visit(c, fn)
}

function textOf(node) {
    let out = ''
    visit(node, (n) => { if (n.type === 'text') out += n.value })
    return out
}

export function rehypeSlugInline() {
    return (tree) => {
        visit(tree, (node) => {
            if (node.type !== 'element' || !HEADINGS.has(node.tagName)) return
            node.properties = node.properties || {}
            if (node.properties.id) return
            const id = slugify(textOf(node))
            if (id) node.properties.id = id
        })
    }
}
