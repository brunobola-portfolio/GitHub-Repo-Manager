import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { rehypeSlugInline } from './__rehype-slug-inline'

// Sanitize schema: defaults + relax a handful of attributes that GitHub
// READMEs habitually use. Tag/attribute lists are explicit-allow only.
// clobberPrefix is cleared so that id slugs from rehypeSlugInline are
// preserved as-is rather than being prefixed with "user-content-".
const SCHEMA = {
    ...defaultSchema,
    clobberPrefix: '',
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
    return /^[a-z]+:\/\//i.test(url) || url.startsWith('#') || url.startsWith('mailto:')
}

function rewriteImageUri(uri, owner, repo, branch) {
    if (!uri || isAbsolute(uri)) return uri
    const clean = uri.replace(/^\.\//, '').replace(/^\//, '')
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${clean}`
}

function rewriteLinkUri(uri, owner, repo, branch) {
    if (!uri || isAbsolute(uri)) return uri
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
                }}
            >
                {source}
            </ReactMarkdown>
        </div>
    )
}
