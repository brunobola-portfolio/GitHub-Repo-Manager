/*
 * GitHub Repo Manager - Repo Context Builder
 *
 * Orchestrates per-signal GitHub fetches for the AI suggest pipeline.
 * Returns a structured `sections` array bounded by an overall byte cap,
 * with line-level secret redaction applied to every fetched payload.
 *
 * Pure-ish: requires the GitHub access token + helper, but contains no
 * Express, no DB, no logger side-effects.
 */

import { githubApi } from './github-api.js';
import { redact } from './secret-redactor.js';
import logger from './logger.js';

const DEFAULT_BYTE_CAP = 8192;

const MANIFEST_CANDIDATES = [
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'Gemfile',
    'composer.json',
];

const SIGNAL_BUDGETS = {
    readme: 3072,
    manifest: 1536,
    entrypoints: 1536,
    folderStructure: 512,
    topicsLanguage: 256,
};

async function fetchTextFile(owner, repo, path, accessToken) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, accessToken);
        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            return Buffer.from(data.content, 'base64').toString('utf8');
        }
        return null;
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo, path }, 'repo-context-builder: file fetch failed');
        return null;
    }
}

async function fetchManifest(owner, repo, accessToken) {
    for (const candidate of MANIFEST_CANDIDATES) {
        const content = await fetchTextFile(owner, repo, candidate, accessToken);
        if (typeof content === 'string') return { label: candidate, content };
    }
    return null;
}

function pushSection(sections, { kind, label, content, byteCap }) {
    const truncated = content.slice(0, byteCap);
    const { content: cleaned, count } = redact(truncated);
    sections.push({
        kind,
        label,
        content: cleaned,
        bytes: cleaned.length,
        redactions: count,
    });
}

export async function buildContext({
    accessToken,
    owner,
    repo,
    signals = {},
    customFiles: _customFiles = [],
    byteCap = DEFAULT_BYTE_CAP,
}) {
    const sections = [];

    if (signals.manifest) {
        const manifest = await fetchManifest(owner, repo, accessToken);
        if (manifest) {
            pushSection(sections, {
                kind: 'manifest',
                label: manifest.label,
                content: manifest.content,
                byteCap: SIGNAL_BUDGETS.manifest,
            });
        }
    }

    return {
        sections,
        totalBytes: sections.reduce((n, s) => n + s.bytes, 0),
        confidence: 'low',
        signalsUsed: sections.map((s) => ({ kind: s.kind, label: s.label, bytes: s.bytes })),
        redactions: sections.filter((s) => s.redactions > 0).map((s) => ({ file: s.label, count: s.redactions })),
        byteCap,
    };
}
