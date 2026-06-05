/**
 * Classify an Azure DevOps host into one of three provider families.
 *
 * The wizard uses this to:
 *   - Show a clear identity badge ("Azure DevOps Cloud", "TFS on-premises", …)
 *   - Pick the correct PAT generation URL
 *   - Hide cloud-only credential modes (OAuth) when on-prem is detected
 *   - Show provider-specific help and docs links
 *
 * This is a pure function — no network calls, no React hooks.
 */

export const PROVIDERS = {
  CLOUD: 'cloud',
  VSTS: 'vsts',           // legacy *.visualstudio.com (still routes to cloud)
  ON_PREM: 'on-prem',     // any other host (TFS / Azure DevOps Server)
  UNKNOWN: 'unknown',
}

/**
 * @param {string|null|undefined} host  hostname[:port]
 * @returns {{
 *   type: 'cloud'|'vsts'|'on-prem'|'unknown',
 *   label: string,                     // short label for badges
 *   longLabel: string,                 // full descriptive label
 *   shortName: string,                 // one-word brand name (eg. "Azure DevOps")
 *   tone: 'indigo'|'sky'|'violet'|'slate',
 *   isCloud: boolean,
 *   supportsOAuth: boolean,            // Azure AD OAuth is cloud-only
 *   docsUrl: string,
 * }}
 */
export function classifyProvider(host) {
  if (!host || typeof host !== 'string') {
    return {
      type: PROVIDERS.UNKNOWN,
      label: 'Not detected',
      longLabel: 'Provider not detected',
      shortName: 'Azure DevOps',
      tone: 'slate',
      isCloud: false,
      supportsOAuth: false,
      docsUrl: 'https://learn.microsoft.com/azure/devops/',
    }
  }
  const h = host.toLowerCase().split(':')[0]
  if (h === 'dev.azure.com') {
    return {
      type: PROVIDERS.CLOUD,
      label: 'Azure DevOps Cloud',
      longLabel: 'Azure DevOps Services (cloud)',
      shortName: 'Azure DevOps',
      tone: 'indigo',
      isCloud: true,
      supportsOAuth: true,
      docsUrl: 'https://learn.microsoft.com/azure/devops/user-guide/sign-up-invite-teammates',
    }
  }
  if (h.endsWith('.visualstudio.com')) {
    return {
      type: PROVIDERS.VSTS,
      label: 'Visual Studio (legacy)',
      longLabel: 'Visual Studio Team Services — routes to Azure DevOps Cloud',
      shortName: 'VSTS',
      tone: 'sky',
      isCloud: true,
      supportsOAuth: true,
      docsUrl: 'https://learn.microsoft.com/azure/devops/release-notes/2018/sep-10-azure-devops-launch',
    }
  }
  // Everything else is treated as on-premises Azure DevOps Server / TFS.
  // We don't try to distinguish TFS versions here — the cascade strategies
  // in tfvc.js handle capability detection at request time.
  return {
    type: PROVIDERS.ON_PREM,
    label: 'TFS / Azure DevOps Server',
    longLabel: 'Azure DevOps Server (on-premises)',
    shortName: 'TFS',
    tone: 'violet',
    isCloud: false,
    supportsOAuth: false,
    docsUrl: 'https://learn.microsoft.com/azure/devops/server/',
  }
}

/** Tailwind class lookup for a given provider tone. Pure helper. */
export function providerToneClasses(tone) {
  switch (tone) {
    case 'indigo':
      return {
        bg: 'bg-indigo-50 dark:bg-indigo-900/20',
        border: 'border-indigo-200 dark:border-indigo-800',
        text: 'text-indigo-700 dark:text-indigo-300',
        iconText: 'text-indigo-500 dark:text-[color:var(--ds-accent-brand-dark)]',
        dot: 'bg-indigo-500',
      }
    case 'sky':
      return {
        bg: 'bg-sky-50 dark:bg-sky-900/20',
        border: 'border-sky-200 dark:border-sky-800',
        text: 'text-sky-700 dark:text-sky-300',
        iconText: 'text-sky-500 dark:text-sky-400',
        dot: 'bg-sky-500',
      }
    case 'violet':
      return {
        bg: 'bg-violet-50 dark:bg-violet-900/20',
        border: 'border-violet-200 dark:border-violet-800',
        text: 'text-violet-700 dark:text-violet-300',
        iconText: 'text-violet-500 dark:text-violet-400',
        dot: 'bg-violet-500',
      }
    default:
      return {
        bg: 'bg-slate-50 dark:bg-slate-900/40',
        border: 'border-slate-200 dark:border-slate-700',
        text: 'text-slate-700 dark:text-slate-300',
        iconText: 'text-slate-500 dark:text-slate-400',
        dot: 'bg-slate-400',
      }
  }
}

/**
 * Build the User Settings → PAT page URL for a given host + org.
 * Works across cloud (dev.azure.com), VSTS, and on-prem TFS.
 *
 * @param {string} host
 * @param {string} org may contain "/" for on-prem collection prefix (e.g. "tfs/DefaultCollection")
 * @returns {string|null}
 */
export function buildPatSettingsUrl(host, org) {
  if (!host || !org) return null
  const cleanHost = host.replace(/\/+$/, '')
  const orgPath = org.split('/').map(encodeURIComponent).join('/')
  return `https://${cleanHost}/${orgPath}/_usersSettings/tokens`
}

/**
 * az CLI login command, host-aware. On cloud this is just the org URL.
 * On on-prem the user needs both `az` and the `azure-devops` extension.
 */
export function buildAzCliCommand(host, org) {
  if (!host || !org) return null
  return `az devops login --organization "https://${host}/${org}"`
}
