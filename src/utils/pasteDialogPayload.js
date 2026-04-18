/**
 * Build the modal payload that opens the Migration Wizard from a completed
 * paste-URL dialog. Pure function — no side effects.
 *
 * The dialog's `status` must be `'ready'` and `answers` must contain
 * `targetOrg`. `targetName` is optional: empty or "manter" (case-insensitive)
 * means "use the detected repo name from the parsed URL".
 *
 * @param {object} dialog  { sourceType, parsed, answers }
 * @returns {{
 *   initialSource: object,
 *   initialRepos: Array,
 *   initialStep: string,
 * }}
 */
export function buildWizardPayload(dialog) {
  const detectedName = dialog.parsed.repo
  const answerName = (dialog.answers.targetName || '').trim()
  const finalName = !answerName || answerName.toLowerCase() === 'manter'
    ? detectedName
    : answerName

  if (dialog.sourceType === 'azure') {
    const { org, project, repo } = dialog.parsed
    return {
      initialSource: {
        sourceType: 'azure',
        org: org || '',
        project: project || '',
        targetOrg: dialog.answers.targetOrg,
        targetName: finalName || '',
      },
      initialRepos: repo
        ? [{ id: `paste-${repo}`, name: repo, selected: true, targetName: finalName || repo }]
        : [],
      initialStep: repo ? 'repoConfig' : 'azureConnect',
    }
  }

  const { owner, repo } = dialog.parsed
  return {
    initialSource: {
      sourceType: 'github',
      githubSourceUrl: `https://github.com/${owner}/${repo}`,
      targetOrg: dialog.answers.targetOrg,
      targetName: finalName || '',
    },
    initialRepos: [],
    initialStep: 'targetConfig',
  }
}
