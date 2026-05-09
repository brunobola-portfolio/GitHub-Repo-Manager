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

async function fetchReadme(owner, repo, accessToken) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/readme`, accessToken);
        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            return Buffer.from(data.content, 'base64').toString('utf8');
        }
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo }, 'repo-context-builder: README fetch failed');
    }
    return null;
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

function topicsLanguageContent({ topics, language }) {
    const parts = [];
    if (language) parts.push(`language: ${language}`);
    if (Array.isArray(topics) && topics.length) parts.push(`topics: ${topics.slice(0, 10).join(', ')}`);
    return parts.join('\n');
}

function computeConfidence({ readmeBytes, manifestPresent, topicsPresent, languagePresent }) {
    if (readmeBytes >= 500 && manifestPresent && (topicsPresent || languagePresent)) return 'high';
    if (readmeBytes >= 100 || manifestPresent) return 'medium';
    return 'low';
}

export async function buildContext({
    accessToken,
    owner,
    repo,
    signals = {},
    customFiles: _customFiles = [],
    byteCap = DEFAULT_BYTE_CAP,
    topicsLanguageInputs = { topics: [], language: null },
}) {
    const sections = [];
    let readmeBytes = 0;

    if (signals.readme) {
        const readme = await fetchReadme(owner, repo, accessToken);
        if (typeof readme === 'string') {
            pushSection(sections, {
                kind: 'readme',
                label: 'README',
                content: readme,
                byteCap: SIGNAL_BUDGETS.readme,
            });
            readmeBytes = sections.at(-1).bytes;
        }
    }

    let manifestPresent = false;
    if (signals.manifest) {
        const manifest = await fetchManifest(owner, repo, accessToken);
        if (manifest) {
            manifestPresent = true;
            pushSection(sections, {
                kind: 'manifest',
                label: manifest.label,
                content: manifest.content,
                byteCap: SIGNAL_BUDGETS.manifest,
            });
        }
    }

    const topicsPresent = Array.isArray(topicsLanguageInputs.topics) && topicsLanguageInputs.topics.length > 0;
    const languagePresent = !!topicsLanguageInputs.language;
    if ((signals.topics && topicsPresent) || (signals.language && languagePresent)) {
        const content = topicsLanguageContent({
            topics: signals.topics ? topicsLanguageInputs.topics : [],
            language: signals.language ? topicsLanguageInputs.language : null,
        });
        if (content) {
            pushSection(sections, {
                kind: 'topicsLanguage',
                label: 'topics + language',
                content,
                byteCap: SIGNAL_BUDGETS.topicsLanguage,
            });
        }
    }

    return {
        sections,
        totalBytes: sections.reduce((n, s) => n + s.bytes, 0),
        confidence: computeConfidence({
            readmeBytes,
            manifestPresent,
            topicsPresent: signals.topics && topicsPresent,
            languagePresent: signals.language && languagePresent,
        }),
        signalsUsed: sections.map((s) => ({ kind: s.kind, label: s.label, bytes: s.bytes })),
        redactions: sections.filter((s) => s.redactions > 0).map((s) => ({ file: s.label, count: s.redactions })),
        byteCap,
    };
}
