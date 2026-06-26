import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

/**
 * Shared react-markdown configuration for untrusted / user-supplied markdown
 * (AI output, GitHub comment bodies). Single source of truth so every render
 * site gets the same hardening: GitHub-flavored tables/strikethrough,
 * rehype-sanitize XSS hardening, and links forced to open safely in a new tab.
 *
 * Spread onto a <ReactMarkdown {...safeMarkdownProps}> when the call site
 * already provides its own wrapper/typography (e.g. a `prose` bubble). When you
 * just need a ready-made block, use the <SafeMarkdown> component instead, which
 * applies these props plus a `prose` wrapper.
 */
export const safeMarkdownProps = {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeSanitize],
    components: {
        a: ({ node, ...props }) => (
            // eslint-disable-next-line jsx-a11y/anchor-has-content -- children come from react-markdown via {...props}
            <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
    },
}
