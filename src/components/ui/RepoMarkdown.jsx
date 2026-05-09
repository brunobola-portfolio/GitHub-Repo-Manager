import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { rehypeSlugInline } from './__rehype-slug-inline'

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

export function RepoMarkdown({ source, owner, repo, branch = 'main', className = '' }) {
    const transformImage = useMemo(() => (uri) => rewriteImageUri(uri, owner, repo, branch), [owner, repo, branch])
    const transformLink  = useMemo(() => (uri) => rewriteLinkUri(uri, owner, repo, branch), [owner, repo, branch])

    if (!source) return null

    return (
        <div className={`prose prose-sm dark:prose-invert max-w-none ds-readme ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeSlugInline, [rehypeSanitize, SCHEMA]]}
                urlTransform={(url, key) => {
                    if (key === 'src') return transformImage(url)
                    if (key === 'href') return transformLink(url)
                    return url
                }}
                components={{
                    a: ({ node, ...props }) => (
                        // eslint-disable-next-line jsx-a11y/anchor-has-content -- children come from react-markdown
                        <a {...props} target="_blank" rel="noopener noreferrer" />
                    ),
                    code: ({ inline, className, children, ...rest }) => {
                        if (inline) return <code className={className} {...rest}>{children}</code>
                        // Block code — preserve the language class so Shiki / our syntax CSS
                        // can theme it. We don't tokenize at render-time (cost-prohibitive for
                        // long READMEs); we add the class and let the existing Shiki theme CSS
                        // bundle (loaded by @git-diff-view/shiki elsewhere) style it.
                        return <code className={className || ''} {...rest}>{children}</code>
                    },
                }}
            >
                {source}
            </ReactMarkdown>
        </div>
    )
}
