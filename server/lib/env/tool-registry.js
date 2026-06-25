// SPDX-License-Identifier: AGPL-3.0-only
// Declarative catalog of the system CLI tools the migration engine needs.
// Pure data + lookups — no I/O. This is the single source of truth that
// detect/installer/readiness and every surface (doctor CLI, /api/env, UI) read.

const ALL = ['win32', 'darwin', 'linux'];

/** @type {Array<object>} */
export const TOOLS = [
  {
    id: 'git',
    label: 'Git',
    docsUrl: 'https://git-scm.com/downloads',
    platforms: ALL,
    detect: { cmd: 'git', args: ['--version'], versionRegex: /git version (\d+\.\d+\.\d+)/ },
    minVersion: '2.20.0',
    capabilities: ['git-import', 'lfs', 'lfs-migrate', 'tfvc'],
    required: true,
    installers: {
      winget: { id: 'Git.Git' },
      choco: { id: 'git' },
      scoop: { id: 'git' },
      apt: { id: 'git' },
      dnf: { id: 'git' },
      pacman: { id: 'git' },
      zypper: { id: 'git' },
      brew: { id: 'git' },
    },
    notes: null,
  },
  {
    id: 'git-lfs',
    label: 'Git LFS',
    docsUrl: 'https://git-lfs.com',
    platforms: ALL,
    detect: { cmd: 'git', args: ['lfs', 'version'], versionRegex: /git-lfs\/(\d+\.\d+\.\d+)/ },
    minVersion: '2.0.0',
    capabilities: ['lfs', 'lfs-migrate'],
    required: false,
    installers: {
      winget: { id: 'GitHub.GitLFS' },
      choco: { id: 'git-lfs' },
      scoop: { id: 'git-lfs' },
      apt: { id: 'git-lfs' },
      dnf: { id: 'git-lfs' },
      pacman: { id: 'git-lfs' },
      zypper: { id: 'git-lfs' },
      brew: { id: 'git-lfs' },
    },
    postInstall: ['lfs', 'install'],
    notes: null,
  },
  {
    id: 'git-tfs',
    label: 'git-tfs (TFVC → Git)',
    docsUrl: 'https://github.com/git-tfs/git-tfs',
    platforms: ['win32'],
    detect: { cmd: 'git-tfs', args: ['--version'], versionRegex: /git-tfs version (\d+\.\d+\.\d+)/ },
    minVersion: null,
    capabilities: ['tfvc-clone'],
    required: false,
    installers: {
      choco: { id: 'gittfs' },
      scoop: { id: 'git-tfs' },
    },
    // git-tfs also needs VS Build Tools + TFS Client OM, which is NOT scriptable here.
    notes:
      'git-tfs additionally requires Visual Studio Build Tools 2017+ with the TFS Client Object Model. Install those manually if TFVC clones fail after git-tfs is present.',
  },
  {
    id: 'tf',
    label: 'TFVC client (tf)',
    docsUrl: 'https://learn.microsoft.com/azure/devops/repos/tfvc/',
    platforms: ALL,
    detect: { cmd: 'tf', args: ['vc', 'help'], versionRegex: /Version (\d+\.\d+\.\d+)/ },
    minVersion: null,
    capabilities: ['tfvc'],
    required: false,
    installers: {},
    notes:
      'The TFVC command-line client ships with Visual Studio / Team Explorer Everywhere and is not installable via a package manager. Install Visual Studio or TEE and ensure `tf` is on PATH.',
  },
];

/** Find a tool by id. */
export function getTool(id) {
  return TOOLS.find((t) => t.id === id);
}

/** Tools relevant to a given platform (`process.platform` value). */
export function toolsForPlatform(platform) {
  return TOOLS.filter((t) => t.platforms.includes(platform));
}
