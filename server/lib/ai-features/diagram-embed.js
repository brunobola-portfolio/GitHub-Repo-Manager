// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Diagram embed — pure helpers for writing a generated Mermaid diagram INTO
 * the repository itself (Addendum 6b.1, docs/specs/2026-07-18-community-wow-
 * wave6.md). Two embed targets, both idempotent via an HTML-comment marker
 * pair so regenerating REPLACES the previous block instead of duplicating it:
 *
 *   - readme-mermaid: a ```mermaid fence inserted directly into README.md
 *   - svg-file:       docs/diagrams/<type>.svg + a markdown image reference
 *     in the README, wrapped in the SAME marker convention for the same
 *     regen-replaces-not-duplicates reason
 *
 * Every function here is pure string transformation — no GitHub/network
 * calls — so the whole insert/replace/malformed-marker/placement matrix is
 * unit-testable without mocking anything. The one exception in spirit is
 * `sanitizeSvg`, which is still pure (no I/O) but does real security work:
 * this codebase has no existing server-side SVG sanitizer (the client's
 * `parseAndSanitizeSvg` in src/utils/sanitizeSvg.js is DOM/browser-only), so
 * this is a fresh, minimal, strict, regex-based pass written for this slice.
 */

import { stripUntilStable } from '../strip-until-stable.js';

export const MAX_SVG_BYTES = 500 * 1024; // 500 KB guard, per the addendum

export function markerStart(type) {
    return `<!-- repo-manager:diagram:${type}:start -->`;
}

export function markerEnd(type) {
    return `<!-- repo-manager:diagram:${type}:end -->`;
}

/**
 * Build the README embed block for the mermaid-fence target.
 * @param {{ type: string, mermaid: string, truncated?: boolean }} args
 * @returns {string}
 */
export function buildMermaidEmbedBlock({ type, mermaid, truncated }) {
    const note = truncated ? '\n<!-- generated from a partial (truncated) file tree -->' : '';
    return `${markerStart(type)}${note}\n\`\`\`mermaid\n${String(mermaid || '').trim()}\n\`\`\`\n${markerEnd(type)}`;
}

/**
 * Build the README embed block for the svg-file target (an image reference
 * pointing at the committed SVG, wrapped in the same marker convention so
 * regeneration replaces rather than duplicates the reference).
 * @param {{ type: string, svgPath: string, label: string, truncated?: boolean }} args
 * @returns {string}
 */
export function buildSvgRefEmbedBlock({ type, svgPath, label, truncated }) {
    const note = truncated ? '\n<!-- generated from a partial (truncated) file tree -->' : '';
    return `${markerStart(type)}${note}\n![${label}](${svgPath})\n${markerEnd(type)}`;
}

/**
 * Locate an existing marker pair for `type` in `content`.
 *   - 'absent'    — neither marker present
 *   - 'valid'     — both present, start before end
 *   - 'malformed' — only one present, or end before start (half/corrupt
 *     markers, e.g. hand-edited) — per the addendum, this is treated as
 *     absent for insertion purposes, with a notice surfaced to the caller
 * @param {string} content
 * @param {string} type
 */
export function findMarkerBlock(content, type) {
    if (typeof content !== 'string' || !content) return { state: 'absent' };
    const start = markerStart(type);
    const end = markerEnd(type);
    const startIdx = content.indexOf(start);
    const endIdx = content.indexOf(end);

    if (startIdx === -1 && endIdx === -1) return { state: 'absent' };
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        return { state: 'malformed', startIdx, endIdx };
    }
    return { state: 'valid', startIdx, endIdx: endIdx + end.length };
}

function joinParts(parts) {
    const nonEmpty = parts.filter((p) => p != null && p !== '');
    return `${nonEmpty.join('\n\n')}\n`;
}

// "After first H1/intro" — consumes an optional leading heading line plus the
// paragraph that follows it (up to the next blank line or heading) and
// returns the character offset right after that paragraph. Falls back to
// "after the first paragraph" when there's no heading, and to 0 (top) for
// empty/whitespace-only content.
function findAfterIntroIndex(content) {
    if (!content) return 0;
    const lines = content.split('\n');
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) return 0;

    if (/^#{1,6}\s+/.test(lines[i])) i++;
    while (i < lines.length && lines[i].trim() === '') i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^#{1,6}\s+/.test(lines[i])) i++;

    let offset = 0;
    for (let j = 0; j < i; j++) offset += lines[j].length + 1;
    return Math.min(offset, content.length);
}

// Returns the char offset right after the first line containing `anchorText`
// verbatim, or -1 when no line matches.
function findAnchorLineEnd(content, anchorText) {
    const lines = content.split('\n');
    let offset = 0;
    for (const line of lines) {
        if (line.includes(anchorText)) return offset + line.length + 1;
        offset += line.length + 1;
    }
    return -1;
}

/**
 * Insert or replace the marker-delimited `block` inside `readmeContent`.
 *
 * - Existing valid marker pair       → REPLACE the block in place.
 * - Malformed markers (only one, or
 *   out of order)                    → treated as absent; block is appended
 *                                       at the end; a notice is returned.
 * - No markers, placement 'top'      → inserted at the very top.
 * - No markers, placement 'end'      → appended at the end.
 * - No markers, placement 'custom'   → inserted right after the first line
 *                                       containing `customAnchor`; falls back
 *                                       to the end (with a notice) if the
 *                                       anchor isn't found.
 * - No markers, placement 'after-
 *   intro' (default)                 → inserted after the first H1/intro.
 *
 * @param {string} readmeContent
 * @param {string} type
 * @param {string} block
 * @param {{ placement?: 'top'|'after-intro'|'end'|'custom', customAnchor?: string }} [opts]
 * @returns {{ content: string, action: 'replaced'|'inserted'|'appended-malformed', notice: string|null }}
 */
export function insertOrReplaceBlock(readmeContent, type, block, opts = {}) {
    const placement = opts.placement || 'after-intro';
    const base = typeof readmeContent === 'string' ? readmeContent : '';
    const marker = findMarkerBlock(base, type);

    if (marker.state === 'valid') {
        const before = base.slice(0, marker.startIdx).replace(/\n+$/, '');
        const after = base.slice(marker.endIdx).replace(/^\n+/, '');
        return { content: joinParts([before, block, after]), action: 'replaced', notice: null };
    }

    if (marker.state === 'malformed') {
        return {
            content: joinParts([base.replace(/\n+$/, ''), block]),
            action: 'appended-malformed',
            notice: 'Existing diagram markers were malformed (only one of the start/end markers was found) — treated as absent; a fresh block was appended at the end.',
        };
    }

    if (placement === 'top') {
        return { content: joinParts([block, base.replace(/^\n+/, '')]), action: 'inserted', notice: null };
    }
    if (placement === 'end') {
        return { content: joinParts([base.replace(/\n+$/, ''), block]), action: 'inserted', notice: null };
    }
    if (placement === 'custom' && opts.customAnchor) {
        const idx = findAnchorLineEnd(base, opts.customAnchor);
        if (idx === -1) {
            return {
                content: joinParts([base.replace(/\n+$/, ''), block]),
                action: 'inserted',
                notice: `Custom anchor "${opts.customAnchor}" was not found in the README — appended at the end instead.`,
            };
        }
        return {
            content: joinParts([base.slice(0, idx).replace(/\n+$/, ''), block, base.slice(idx).replace(/^\n+/, '')]),
            action: 'inserted',
            notice: null,
        };
    }

    const idx = findAfterIntroIndex(base);
    return {
        content: joinParts([base.slice(0, idx).replace(/\n+$/, ''), block, base.slice(idx).replace(/^\n+/, '')]),
        action: 'inserted',
        notice: null,
    };
}

// ---------------------------------------------------------------------------
// Deterministic no-AI fallback diagram (referenced by 6b.1's "invalid mermaid
// after the retry-once self-repair" edge case, which falls back to this
// rather than failing the embed — same deterministic-structure-diagram shape
// the addendum's 6b.2 section describes).
// ---------------------------------------------------------------------------

function escapeMermaidLabel(label) {
    return String(label || '').replace(/["<>]/g, '').trim() || 'unnamed';
}

/**
 * Build a deterministic `flowchart TD` of the top-level directory structure
 * (depth-capped, node-capped) — zero AI cost, always succeeds. Used as the
 * embed-time fallback when the AI-generated Mermaid still fails to render
 * after the one automatic self-repair attempt.
 * @param {{ topLevel?: Array<{name:string,type:string}>, treeEntries?: Array<{path:string}>, truncated?: boolean, depth?: number, maxNodes?: number }} args
 * @returns {string}
 */
export function buildDeterministicDiagram({ topLevel = [], treeEntries = [], truncated = false, depth = 2, maxNodes = 40 } = {}) {
    const nodeIds = new Map(); // dir path -> mermaid node id
    const edges = [];
    let counter = 0;

    const idFor = (path) => {
        if (!nodeIds.has(path)) nodeIds.set(path, `n${counter++}`);
        return nodeIds.get(path);
    };

    const addPath = (relPath) => {
        const parts = String(relPath || '').split('/').filter(Boolean);
        const dirParts = parts.slice(0, -1).slice(0, depth);
        let prevPath = null;
        for (const seg of dirParts) {
            const path = prevPath ? `${prevPath}/${seg}` : seg;
            if (!nodeIds.has(path) && nodeIds.size >= maxNodes) return;
            const isNew = !nodeIds.has(path);
            const id = idFor(path);
            if (isNew) edges.push([prevPath ? idFor(prevPath) : 'root', id]);
            prevPath = path;
        }
    };

    const sourcePaths = treeEntries.length > 0
        ? treeEntries.map((e) => e.path)
        : topLevel.filter((f) => f.type === 'dir').map((f) => `${f.name}/__placeholder__`);

    for (const p of sourcePaths) {
        if (nodeIds.size >= maxNodes) break;
        addPath(p);
    }

    const lines = ['flowchart TD', '  root["repository root"]'];
    for (const [path, id] of nodeIds) {
        lines.push(`  ${id}["${escapeMermaidLabel(path.split('/').pop())}"]`);
    }
    for (const [from, to] of edges) {
        lines.push(`  ${from} --> ${to}`);
    }
    if (nodeIds.size === 0) {
        lines.push('  root --> empty["not enough directory structure detected"]');
    }
    if (truncated) lines.push('  %% generated from a partial (truncated) file tree');
    lines.push('  %% Structure diagram (deterministic — enable an AI provider for richer diagrams)');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// SVG sanitizer — strict, regex-based, server-side (no DOM available in
// Node). Rejects/strips: <script>, <foreignObject>, <iframe>, <embed>,
// <object>, SMIL animate* elements, on*="" event handlers (quoted and
// unquoted), href/xlink:href pointing anywhere but an in-document fragment
// (#id) — this also covers javascript:/data:/vbscript: schemes since ANY
// non-fragment reference is stripped — DOCTYPE/ENTITY declarations (XXE /
// entity-expansion defence), processing instructions, comments (can hide a
// payload split across two sanitizer passes), and @import inside <style>.
// Also enforces the addendum's <500KB size guard.
// ---------------------------------------------------------------------------

const DANGEROUS_TAGS = ['script', 'foreignObject', 'iframe', 'embed', 'object', 'animate', 'animateMotion', 'animateTransform', 'set'];

function stripTag(svg, tag) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/>`, 'gi');
    return svg.replace(paired, '').replace(selfClosing, '');
}

/**
 * @param {string} rawSvg
 * @param {{ maxBytes?: number }} [opts]
 * @returns {{ ok: true, svg: string, byteLength: number } | { ok: false, reason: string, byteLength?: number, maxBytes?: number }}
 */
export function sanitizeSvg(rawSvg, opts = {}) {
    const maxBytes = opts.maxBytes ?? MAX_SVG_BYTES;
    if (typeof rawSvg !== 'string' || !rawSvg.trim()) {
        return { ok: false, reason: 'empty' };
    }

    const byteLength = Buffer.byteLength(rawSvg, 'utf8');
    if (byteLength > maxBytes) {
        return { ok: false, reason: 'too_large', byteLength, maxBytes };
    }

    let svg = rawSvg;

    // XXE / entity-expansion defence + processing instructions + comments
    // (stripped before content inspection, so a payload can't hide behind
    // a comment that a naive single-pass regex would otherwise skip over).
    const prologue = stripUntilStable(svg, (v) => v
        .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
        .replace(/<!ENTITY[\s\S]*?>/gi, '')
        .replace(/<\?[\s\S]*?\?>/g, '')
        .replace(/<!--[\s\S]*?-->/g, ''));
    if (!prologue.ok) return { ok: false, reason: 'unsanitizable' };
    svg = prologue.value;

    if (!/<svg[\s>]/i.test(svg)) {
        return { ok: false, reason: 'not_svg' };
    }

    const tags = stripUntilStable(svg, (v) => DANGEROUS_TAGS.reduce(stripTag, v));
    if (!tags.ok) return { ok: false, reason: 'unsanitizable' };
    svg = tags.value;

    // Event-handler attributes: quoted (both styles) and bare/unquoted.
    const handlers = stripUntilStable(svg, (v) => v
        .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
        .replace(/\son\w+\s*=\s*[^\s>]+/gi, ''));
    if (!handlers.ok) return { ok: false, reason: 'unsanitizable' };
    svg = handlers.value;

    // href/xlink:href — keep only in-document fragment refs (#id), used
    // internally by mermaid/SVG for gradients, markers, <use>; strip every
    // external/absolute reference (covers javascript:/data:/vbscript: too).
    svg = svg.replace(/\s(xlink:href|href)\s*=\s*"([^"]*)"/gi, (m, attr, val) => (val.trim().startsWith('#') ? ` ${attr}="${val}"` : ''));
    svg = svg.replace(/\s(xlink:href|href)\s*=\s*'([^']*)'/gi, (m, attr, val) => (val.trim().startsWith('#') ? ` ${attr}='${val}'` : ''));

    // Strip @import inside <style> blocks (potential external resource load).
    svg = svg.replace(/@import[^;]*;?/gi, '');

    const trimmed = svg.trim();
    if (!/<svg[\s>]/i.test(trimmed) || !/<\/svg>\s*$/i.test(trimmed)) {
        return { ok: false, reason: 'invalid_after_sanitize' };
    }

    return { ok: true, svg: trimmed, byteLength: Buffer.byteLength(trimmed, 'utf8') };
}
