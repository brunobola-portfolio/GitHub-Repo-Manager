import { cloneElement, createContext, createElement, useContext, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { rehypeSlugInline } from './__rehype-slug-inline'
import { AnimatedCopyIcon } from './AnimatedCopyIcon'
import { parseAndSanitizeSvg } from '../../utils/sanitizeSvg'

// Sanitize schema: defaults + relax a handful of attributes that GitHub
// READMEs habitually use. Tag/attribute lists are explicit-allow only.
// clobberPrefix: 'readme-' namespaces ALL ids and fragment hrefs so README
// content can never collide with app-shell ids (e.g. id="root").
const SCHEMA = {
    ...defaultSchema,
    clobberPrefix: 'readme-',
    attributes: {
        ...defaultSchema.attributes,
        div: [...(defaultSchema.attributes?.div || []), 'align'],
        p: [...(defaultSchema.attributes?.p || []), 'align'],
        img: [...(defaultSchema.attributes?.img || []), 'width', 'height', 'align'],
        h1: [...(defaultSchema.attributes?.h1 || []), 'id'],
        h2: [...(defaultSchema.attributes?.h2 || []), 'id'],
        h3: [...(defaultSchema.attributes?.h3 || []), 'id'],
        h4: [...(defaultSchema.attributes?.h4 || []), 'id'],
        h5: [...(defaultSchema.attributes?.h5 || []), 'id'],
        h6: [...(defaultSchema.attributes?.h6 || []), 'id'],
    },
}

function isAbsolute(url) {
    return /^[a-z]+:\/\//i.test(url) || url.startsWith('mailto:')
}

function rewriteImageUri(uri, owner, repo, branch) {
    if (!uri || isAbsolute(uri) || uri.startsWith('#')) return uri
    const clean = uri.replace(/^\.\//, '').replace(/^\//, '')
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${clean}`
}

function rewriteLinkUri(uri, owner, repo, branch) {
    if (!uri) return uri
    // Fragment links: prefix the anchor to match the readme- namespace on heading ids.
    if (uri.startsWith('#')) return `#readme-${uri.slice(1)}`
    if (isAbsolute(uri)) return uri
    const clean = uri.replace(/^\.\//, '').replace(/^\//, '')
    return `https://github.com/${owner}/${repo}/blob/${branch}/${clean}`
}

// ---------------------------------------------------------------------------
// Fenced code block syntax highlighting.
//
// The app's real, already-bundled highlighter is `lowlight` (highlight.js
// "common" ~40-language subset) via `src/lib/diff-highlighter-shim.js` — the
// same one `DiffRenderer` pays for. We load it with a dynamic `import()`
// (module-level singleton promise so every RepoMarkdown instance shares one
// fetch) instead of a static import, so an eagerly-mounted Overview tab
// doesn't pull the diff-viewer's `vendor-diff` chunk just to highlight a
// README nobody has scrolled to yet. Until it resolves, code blocks render
// as plain (unhighlighted) text — never blocking the README from painting.
//
// The loaded instance is threaded through React Context (not a prop closed
// over by the `components` map) so that `components` itself — and therefore
// every `pre`/`code`/`a` component reference handed to react-markdown — stays
// referentially stable across renders. If `components` changed identity
// whenever the highlighter finished loading, react-markdown/React would treat
// the fenced-block renderer as a brand new component type and remount it,
// wiping any local state (e.g. the copy button's "copied" flash).
// ---------------------------------------------------------------------------
const HighlighterContext = createContext(null)

let highlighterPromise = null
function loadHighlighter() {
    if (!highlighterPromise) {
        highlighterPromise = import('../../lib/diff-highlighter-shim.js').then((m) => m.highlighter)
    }
    return highlighterPromise
}

function useLazyHighlighter() {
    const [highlighter, setHighlighter] = useState(null)
    useEffect(() => {
        let cancelled = false
        loadHighlighter().then((h) => { if (!cancelled) setHighlighter(h) })
        return () => { cancelled = true }
    }, [])
    return highlighter
}

function getLanguageFromClassName(className) {
    if (!className) return null
    const match = /language-(\S+)/.exec(className)
    return match ? match[1] : null
}

// Flattens a React children tree (strings, arrays, nested elements) back into
// plain text — used both to feed the highlighter and to power the copy button,
// so "what gets copied" always matches "what got tokenized". Trailing newline
// stripped once here so every downstream consumer (render + copy) agrees on
// the exact same string (remark leaves a single trailing "\n" on fence content).
function extractCodeText(node) {
    function flatten(n) {
        if (n == null) return ''
        if (typeof n === 'string' || typeof n === 'number') return String(n)
        if (Array.isArray(n)) return n.map(flatten).join('')
        if (n?.props?.children != null) return flatten(n.props.children)
        return ''
    }
    return flatten(node).replace(/\n$/, '')
}

// Converts a lowlight/hast token tree into React elements. This runs on
// output WE generate from plain text (never on sanitizer-controlled user
// HTML), so it's safe to build elements directly rather than routing back
// through rehype-sanitize.
function hastNodeToReact(node, key) {
    if (node.type === 'text') return node.value
    if (node.type === 'element') {
        const props = { key }
        const cls = node.properties?.className
        if (cls) props.className = Array.isArray(cls) ? cls.join(' ') : cls
        const children = (node.children || []).map((child, i) => hastNodeToReact(child, i))
        return createElement(node.tagName, props, children)
    }
    return null
}

// Wraps every fenced code block: tokenizes it (once the highlighter has
// loaded) and adds a copy-to-clipboard button (reusing AnimatedCopyIcon, the
// same affordance CommitDetailPanel uses for SHA copy).
function ReadmeCodeBlock({ children, ...preRest }) {
    const highlighter = useContext(HighlighterContext)
    const [copied, setCopied] = useState(false)

    const codeElement = Array.isArray(children) ? children[0] : children
    const codeClassName = codeElement?.props?.className || ''
    const lang = getLanguageFromClassName(codeClassName)
    const rawText = extractCodeText(codeElement?.props?.children)

    // Default render: the same text, trailing newline normalized, so the
    // visible block always matches what the copy button copies — whether or
    // not tokenization below succeeds.
    let renderedCode = codeElement ? cloneElement(codeElement, { className: codeClassName }, rawText) : children

    if (highlighter && lang && codeElement && highlighter.hasRegisteredCurrentLang(lang)) {
        try {
            const ast = highlighter.getAST(rawText, undefined, lang)
            if (ast?.children) {
                renderedCode = cloneElement(
                    codeElement,
                    { className: `${codeClassName} hljs`.trim() },
                    ast.children.map((node, i) => hastNodeToReact(node, i)),
                )
            }
        } catch {
            // Tokenization failed for this block (unexpected grammar edge case)
            // — fall back to the plain, unhighlighted (but still normalized) text.
        }
    }

    const handleCopy = async () => {
        if (!rawText || !navigator.clipboard?.writeText) return
        try {
            await navigator.clipboard.writeText(rawText)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            // Clipboard permission denied / unavailable — no-op, button stays idle.
        }
    }

    return (
        <div className="relative group/code">
            <pre {...preRest}>{renderedCode}</pre>
            {rawText ? (
                <button
                    type="button"
                    onClick={handleCopy}
                    aria-label={copied ? 'Copied to clipboard' : 'Copy code'}
                    className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-md bg-slate-800/90 dark:bg-slate-700/90 text-slate-200 opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100 hover:bg-slate-700 dark:hover:bg-slate-600 transition-opacity duration-150 ds-focus-ring"
                >
                    <AnimatedCopyIcon copied={copied} checkClassName="text-emerald-400" />
                </button>
            ) : null}
        </div>
    )
}

// ---------------------------------------------------------------------------
// ```mermaid fence rendering — own-app parity with the diagram embed flow.
//
// A README embedded via the AI Diagram Generator's embed action (Addendum
// 6b.1, docs/specs/2026-07-18-community-wow-wave6.md) renders natively on
// GitHub/GitLab; without this, our own README reader would show the same
// fence as an inert, unhighlighted code block. Adapted from the identical
// render pipeline in WalkthroughTab.jsx / DiagramGenerator.jsx: lazy `mermaid`
// import, `securityLevel: 'strict'`, theme-reactive, `parseAndSanitizeSvg`
// defence-in-depth before adopting the resulting Node.
// ---------------------------------------------------------------------------
function ReadmeMermaidBlock({ source }) {
    const mermaidRef = useRef(null)
    const [mermaidError, setMermaidError] = useState(null)
    const [theme, setTheme] = useState(() =>
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'default'
    )

    useEffect(() => {
        if (typeof MutationObserver === 'undefined') return undefined
        const root = document.documentElement
        const observer = new MutationObserver(() => {
            const next = root.classList.contains('dark') ? 'dark' : 'default'
            setTheme((current) => (current === next ? current : next))
        })
        observer.observe(root, { attributes: true, attributeFilter: ['class'] })
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        let cancelled = false
        const src = source?.trim()
        if (!src || !mermaidRef.current) return undefined

        import('mermaid').then((mod) => {
            if (cancelled) return
            const mermaid = mod.default || mod
            // htmlLabels:false emits SVG <text> labels instead of <foreignObject>
            // HTML — parseAndSanitizeSvg strips foreignObject as an XSS defence,
            // which would otherwise erase every flowchart node label.
            mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: true } })
            const id = `readme-mermaid-${Math.random().toString(36).slice(2)}`
            mermaid.render(id, src).then(({ svg }) => {
                if (cancelled || !mermaidRef.current) return
                const node = parseAndSanitizeSvg(svg)
                if (!node) {
                    setMermaidError('Diagram failed to render safely')
                    return
                }
                setMermaidError(null)
                mermaidRef.current.replaceChildren(document.importNode(node, true))
            }).catch((err) => {
                if (!cancelled) setMermaidError(err?.message || 'Failed to render diagram')
            })
        }).catch((err) => {
            if (!cancelled) setMermaidError(err?.message || 'Failed to load mermaid')
        })

        return () => { cancelled = true }
    }, [source, theme])

    if (mermaidError) {
        return <p className="text-xs text-red-600 dark:text-red-400">Diagram failed to render: {mermaidError}</p>
    }
    return (
        <div
            ref={mermaidRef}
            data-testid="readme-mermaid-output"
            className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 p-3 my-2 bg-white dark:bg-slate-900"
        />
    )
}

// Stable across every render (module scope) — passed as-is to react-markdown
// so component identity never churns, regardless of highlighter load state.
const README_COMPONENTS = {
    a: ({ node, ...props }) => (
        // eslint-disable-next-line jsx-a11y/anchor-has-content -- children come from react-markdown
        <a {...props} target="_blank" rel="noopener noreferrer" />
    ),
    code: ({ inline, className: codeClassName, children, ...rest }) => {
        if (inline) return <code className={codeClassName} {...rest}>{children}</code>
        return <code className={codeClassName || ''} {...rest}>{children}</code>
    },
    pre: ({ children, ...rest }) => {
        const codeElement = Array.isArray(children) ? children[0] : children
        const lang = getLanguageFromClassName(codeElement?.props?.className || '')
        if (lang === 'mermaid') {
            return <ReadmeMermaidBlock source={extractCodeText(codeElement?.props?.children)} />
        }
        return <ReadmeCodeBlock {...rest}>{children}</ReadmeCodeBlock>
    },
}

export function RepoMarkdown({ source, owner, repo, branch = 'main', className = '' }) {
    const highlighter = useLazyHighlighter()

    if (!source) return null

    return (
        <div className={`prose prose-sm dark:prose-invert max-w-none ds-readme ${className}`}>
            <HighlighterContext.Provider value={highlighter}>
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw, rehypeSlugInline, [rehypeSanitize, SCHEMA]]}
                    urlTransform={(url, key) => {
                        if (key === 'src') return rewriteImageUri(url, owner, repo, branch)
                        if (key === 'href') return rewriteLinkUri(url, owner, repo, branch)
                        return url
                    }}
                    components={README_COMPONENTS}
                >
                    {source}
                </ReactMarkdown>
            </HighlighterContext.Provider>
        </div>
    )
}
