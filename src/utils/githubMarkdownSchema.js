import { defaultSchema } from 'rehype-sanitize'

/**
 * The rehype-sanitize schema for GitHub-style markdown (READMEs, PR and issue
 * bodies): the explicit-allow default plus the few attributes GitHub content
 * relies on (alignment, image sizing, an open <details>, heading ids). It was
 * written out three times and the copies had drifted apart.
 *
 * `clobberPrefix` namespaces every id and fragment href, so rendered content
 * can never collide with an app-shell id (id="root"); each surface passes its
 * own so two rendered documents on one page cannot collide with each other.
 *
 * @param {string} clobberPrefix
 */
export function buildGitHubSchema(clobberPrefix) {
    const attr = (tag, ...extra) => [...(defaultSchema.attributes?.[tag] || []), ...extra]
    return {
        ...defaultSchema,
        clobberPrefix,
        attributes: {
            ...defaultSchema.attributes,
            div: attr('div', 'align'),
            p: attr('p', 'align'),
            img: attr('img', 'width', 'height', 'align'),
            details: attr('details', 'open'),
            h1: attr('h1', 'id'),
            h2: attr('h2', 'id'),
            h3: attr('h3', 'id'),
            h4: attr('h4', 'id'),
            h5: attr('h5', 'id'),
            h6: attr('h6', 'id'),
        },
    }
}
