/**
 * Wiki Service
 * Migrates Azure DevOps Wikis to GitHub Wiki or docs/ folder.
 * ADO wikis are Git repos — we clone them, convert content, and push.
 */

import { simpleGit } from 'simple-git';
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, dirname, basename, extname } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname as pathDirname } from 'path';
import { getWikiCloneUrl, buildAuthenticatedCloneUrl } from './azure-service.js';
import { isInternalUrl, resolveAndValidateHost } from './lib/url-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);
const TMP_DIR = join(__dirname, 'data', 'tmp');
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Ensure tmp dir exists
if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
}

/**
 * Convert ADO wiki content to GitHub-compatible format.
 *
 * @param {string} content - Markdown content from ADO wiki
 * @param {string} destination - 'wiki' (GitHub Wiki) or 'docs' (docs/ folder)
 * @param {string} [org] - Azure DevOps organization (for work item links)
 * @param {string} [project] - Azure DevOps project (for work item links)
 * @returns {string} Converted content
 */
function convertContent(content, destination, org, project) {
    let result = content;

    // Remove [[_TOC_]]
    result = result.replace(/\[\[_TOC_\]\]/g, '');

    // Convert ::: mermaid blocks to ```mermaid
    result = result.replace(/::: mermaid\n([\s\S]*?):::/g, '```mermaid\n$1```');

    // Convert ::: note / ::: warning / ::: tip admonition blocks
    const admonitionTypes = ['note', 'warning', 'tip'];
    for (const type of admonitionTypes) {
        const regex = new RegExp(`^::: ${type}\\n([\\s\\S]*?)^:::`, 'gm');
        if (destination === 'wiki') {
            const label = type.charAt(0).toUpperCase() + type.slice(1);
            result = result.replace(regex, (_match, body) => {
                const lines = body.trim().split('\n');
                return `> **${label}:**\n` + lines.map(l => `> ${l}`).join('\n');
            });
        } else {
            const tag = type.toUpperCase();
            result = result.replace(regex, (_match, body) => {
                const lines = body.trim().split('\n');
                return `> [!${tag}]\n` + lines.map(l => `> ${l}`).join('\n');
            });
        }
    }

    // Convert @WorkItem:ID to link
    if (org && project) {
        result = result.replace(
            /@WorkItem:(\d+)/g,
            `[ADO Work Item #$1](https://dev.azure.com/${org}/${project}/_workitems/edit/$1)`
        );
    }

    // Convert @query:GUID to comment
    result = result.replace(/@query:[a-zA-Z0-9-]+/g, '<!-- ADO query embed removed -->');

    // Convert internal links and attachment paths based on destination
    if (destination === 'wiki') {
        // [text](/Page-Name) → [[Page-Name]]
        result = result.replace(/\[([^\]]+)\]\(\/([^)]+)\)/g, (_match, _text, page) => {
            // Don't convert attachment references
            if (page.startsWith('.attachments/')) return _match;
            return `[[${page}]]`;
        });
        // Keep attachment paths as-is for wiki
    } else {
        // [text](/Page-Name) → [text](Page-Name.md)
        result = result.replace(/\[([^\]]+)\]\(\/([^)]+)\)/g, (_match, text, page) => {
            // Don't convert attachment references
            if (page.startsWith('.attachments/')) return _match;
            return `[${text}](${page}.md)`;
        });

        // ![img](/.attachments/img.png) → ![img](attachments/img.png)
        result = result.replace(
            /!\[([^\]]*)\]\(\/?\.attachments\/([^)]+)\)/g,
            '![$1](attachments/$2)'
        );
    }

    // Clean up any leftover blank lines from TOC removal
    result = result.replace(/\n{3,}/g, '\n\n');

    return result.trim();
}

/**
 * Convert ADO .order file content to GitHub Wiki _Sidebar.md format.
 * Each line in the .order file becomes a wiki link.
 *
 * @param {string} orderContent - Contents of a .order file
 * @returns {string} _Sidebar.md content
 */
function convertOrderFile(orderContent) {
    if (!orderContent || !orderContent.trim()) return '';

    const lines = orderContent.trim().split('\n').filter(l => l.trim());
    return lines.map(line => `[[${line.trim()}]]`).join('\n');
}

/**
 * Recursively walk a directory and return all file paths.
 */
function walkDir(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '.git') continue;
            files.push(...walkDir(fullPath));
        } else {
            files.push(fullPath);
        }
    }
    return files;
}

/**
 * Migrate an Azure DevOps wiki to GitHub Wiki or docs/ folder.
 *
 * @param {Object} config - Migration configuration
 * @param {string} config.org - Azure DevOps organization
 * @param {string} config.project - Azure DevOps project
 * @param {string} config.wikiId - Azure DevOps wiki ID
 * @param {string} config.destination - 'wiki' or 'docs'
 * @param {Object} azureCreds - { pat } Azure DevOps credentials
 * @param {string} githubToken - GitHub access token
 * @param {string} targetOwner - GitHub owner or org
 * @param {string} targetRepo - GitHub repository name
 * @param {Object} [callbacks] - Progress callbacks
 * @param {function} [callbacks.onProgress] - (status, message, pct) => void
 * @returns {Object} { pagesConverted, destination }
 */
async function migrateWiki(config, azureCreds, githubToken, targetOwner, targetRepo, callbacks = {}) {
    const { org, project, wikiId, destination } = config;
    const { pat } = azureCreds;
    const onProgress = callbacks.onProgress || (() => {});

    const jobId = randomUUID();
    const workDir = join(TMP_DIR, `wiki-${jobId}`);
    const convertedDir = join(TMP_DIR, `wiki-converted-${jobId}`);

    try {
        // Step 1: Get wiki clone URL
        onProgress('fetching', 'Fetching wiki clone URL...', 5);
        const wikiRemoteUrl = await getWikiCloneUrl(org, project, pat, wikiId);
        if (!wikiRemoteUrl) {
            throw new Error('Could not retrieve wiki clone URL from Azure DevOps');
        }

        // SSRF protection
        if (isInternalUrl(wikiRemoteUrl)) {
            throw new Error('Wiki URL targets a private or internal network. Only public HTTPS URLs are allowed.');
        }
        const dnsValid = await resolveAndValidateHost(wikiRemoteUrl);
        if (!dnsValid) {
            throw new Error('Wiki URL resolves to a private or internal network address.');
        }

        // Step 2: Clone the wiki repo
        onProgress('cloning', 'Cloning wiki repository...', 15);
        mkdirSync(workDir, { recursive: true });
        mkdirSync(convertedDir, { recursive: true });

        const authCloneUrl = buildAuthenticatedCloneUrl(wikiRemoteUrl, pat);
        const git = simpleGit({ timeout: { block: DEFAULT_TIMEOUT_MS } });
        await git.clone(authCloneUrl, workDir);

        // Step 3: Discover and convert all files
        onProgress('converting', 'Converting wiki content...', 35);
        const allFiles = walkDir(workDir);
        let pagesConverted = 0;

        for (const filePath of allFiles) {
            const relPath = relative(workDir, filePath);
            const fileName = basename(filePath);
            const ext = extname(filePath).toLowerCase();

            // Handle .order files
            if (fileName === '.order') {
                if (destination === 'wiki') {
                    const orderContent = readFileSync(filePath, 'utf-8');
                    const sidebar = convertOrderFile(orderContent);
                    if (sidebar) {
                        // Determine sidebar location relative to the .order file
                        const orderDir = relative(workDir, dirname(filePath));
                        const sidebarPath = orderDir
                            ? join(convertedDir, orderDir, '_Sidebar.md')
                            : join(convertedDir, '_Sidebar.md');
                        mkdirSync(dirname(sidebarPath), { recursive: true });
                        writeFileSync(sidebarPath, sidebar, 'utf-8');
                    }
                }
                // For docs destination, .order files are removed (not copied)
                continue;
            }

            // Convert markdown files
            if (ext === '.md') {
                const content = readFileSync(filePath, 'utf-8');
                const converted = convertContent(content, destination, org, project);
                const destPath = join(convertedDir, relPath);
                mkdirSync(dirname(destPath), { recursive: true });
                writeFileSync(destPath, converted, 'utf-8');
                pagesConverted++;
            } else {
                // Copy non-markdown files (images, attachments) as-is
                const content = readFileSync(filePath);
                let destRelPath = relPath;

                // For docs destination, rename .attachments to attachments
                if (destination === 'docs' && destRelPath.startsWith('.attachments')) {
                    destRelPath = destRelPath.replace(/^\.attachments/, 'attachments');
                }

                const destPath = join(convertedDir, destRelPath);
                mkdirSync(dirname(destPath), { recursive: true });
                writeFileSync(destPath, content);
            }
        }

        // Step 4: Push to destination
        onProgress('pushing', `Pushing to ${destination === 'wiki' ? 'GitHub Wiki' : 'docs/ folder'}...`, 65);

        if (destination === 'wiki') {
            // GitHub Wiki is a separate git repo at <repo>.wiki.git
            const wikiPushUrl = `https://x-access-token:${githubToken}@github.com/${targetOwner}/${targetRepo}.wiki.git`;

            // Initialize as a git repo and push
            const convertedGit = simpleGit(convertedDir);
            await convertedGit.init();
            await convertedGit.add('.');
            await convertedGit.commit('Import wiki from Azure DevOps');
            await convertedGit.addRemote('origin', wikiPushUrl);
            await convertedGit.push('origin', 'master', ['--force']);
        } else {
            // Push to docs/ folder in the main repo
            const repoDir = join(TMP_DIR, `wiki-repo-${jobId}`);
            mkdirSync(repoDir, { recursive: true });

            try {
                const repoPushUrl = `https://x-access-token:${githubToken}@github.com/${targetOwner}/${targetRepo}.git`;
                const repoGit = simpleGit({ timeout: { block: DEFAULT_TIMEOUT_MS } });
                await repoGit.clone(repoPushUrl, repoDir, ['--depth', '1']);

                // Copy converted files into docs/
                const docsDir = join(repoDir, 'docs');
                mkdirSync(docsDir, { recursive: true });

                const convertedFiles = walkDir(convertedDir);
                for (const srcFile of convertedFiles) {
                    const rel = relative(convertedDir, srcFile);
                    const destFile = join(docsDir, rel);
                    mkdirSync(dirname(destFile), { recursive: true });
                    writeFileSync(destFile, readFileSync(srcFile));
                }

                const docsGit = simpleGit(repoDir);
                await docsGit.add('docs');
                await docsGit.commit('Import wiki from Azure DevOps into docs/');
                await docsGit.push('origin');
            } finally {
                try {
                    if (existsSync(repoDir)) {
                        rmSync(repoDir, { recursive: true, force: true });
                    }
                } catch (e) {
                    console.warn(`[wiki-service] Repo cleanup warning: ${e.message}`);
                }
            }
        }

        onProgress('complete', 'Wiki migration completed successfully!', 100);

        return {
            pagesConverted,
            destination: destination === 'wiki' ? 'GitHub Wiki' : 'docs/ folder'
        };

    } catch (error) {
        onProgress('failed', error.message, 0);
        throw error;
    } finally {
        // Always cleanup temp directories
        for (const dir of [workDir, convertedDir]) {
            try {
                if (existsSync(dir)) {
                    rmSync(dir, { recursive: true, force: true });
                }
            } catch (e) {
                console.warn(`[wiki-service] Cleanup warning: ${e.message}`);
            }
        }
    }
}

export {
    migrateWiki,
    convertContent,
    convertOrderFile
};
