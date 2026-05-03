import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

/**
 * Safely renders untrusted markdown (e.g. AI output) with GitHub-flavored
 * tables/strikethrough and rehype-sanitize for XSS hardening.
 *
 * Use ONLY for AI / user-supplied content. For trusted markdown (docs,
 * fixtures), regular ReactMarkdown without sanitization is fine.
 */
export function SafeMarkdown({ children, className = '' }) {
    if (!children) return null
    return (
        <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
                components={{
                    a: ({ node, ...props }) => (
                        // eslint-disable-next-line jsx-a11y/anchor-has-content -- children come from react-markdown via {...props}
                        <a {...props} target="_blank" rel="noopener noreferrer" />
                    ),
                }}
            >
                {children}
            </ReactMarkdown>
        </div>
    )
}
