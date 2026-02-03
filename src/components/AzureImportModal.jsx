import { useState } from 'react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Select } from './ui/Select'

export function AzureImportModal({ isOpen, onClose, onImport, orgs, isPerforming }) {
    const [azureOrg, setAzureOrg] = useState('')
    const [azureProject, setAzureProject] = useState('')
    const [azureRepo, setAzureRepo] = useState('')
    const [azurePat, setAzurePat] = useState('')
    const [targetOrg, setTargetOrg] = useState('')
    const [targetRepoName, setTargetRepoName] = useState('')
    const [makePrivate, setMakePrivate] = useState(true)

    if (!isOpen) return null

    const handleSubmit = async (e) => {
        e.preventDefault()
        const result = await onImport(azureOrg, azureProject, azureRepo, azurePat, {
            targetOrg: targetOrg || undefined,
            targetRepoName: targetRepoName || undefined,
            makePrivate
        })
        if (result?.success) {
            onClose()
            // Reset form
            setAzureOrg('')
            setAzureProject('')
            setAzureRepo('')
            setAzurePat('')
            setTargetOrg('')
            setTargetRepoName('')
        }
    }

    const isValid = azureOrg && azureProject && azureRepo && azurePat

	    return (
	        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
	            <Card className="w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
	               <div className="flex items-center justify-between mb-4">
	                   <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
	                       <span className="text-2xl">☁️</span>
	                       Import from Azure DevOps
	                   </h2>
	                   <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 text-2xl">
	                       ×
	                   </button>
	               </div>

	               {/* Limitations Warning */}
	               <div className="mb-6 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
	                   <div className="flex gap-2">
	                       <span className="text-amber-600 dark:text-amber-400 text-lg">⚠️</span>
	                       <div className="flex-1">
	                           <h3 className="font-semibold text-amber-800 dark:text-amber-300 text-sm mb-1">
	                               Basic Git Import Only
	                           </h3>
	                           <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
	                               This imports <strong>Git repository code and history only</strong>.
	                               Pull Requests, Work Items, Pipelines, and Wikis are not migrated.
	                               See documentation for manual migration steps.
	                           </p>
	                       </div>
	                   </div>
	               </div>

                <form onSubmit={handleSubmit} className="space-y-4">
	                    {/* Azure DevOps Source */}
	                    <div className="p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-800">
	                        <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-3">Azure DevOps Source</h3>
                        <div className="space-y-3">
                            <div>
	                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Organization *
                                </label>
                                <input
                                    type="text"
                                    value={azureOrg}
                                    onChange={(e) => setAzureOrg(e.target.value)}
                                    placeholder="e.g., mycompany"
	                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                />
                            </div>
                            <div>
	                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Project *
                                </label>
                                <input
                                    type="text"
                                    value={azureProject}
                                    onChange={(e) => setAzureProject(e.target.value)}
                                    placeholder="e.g., MyProject"
	                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                />
                            </div>
                            <div>
	                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Repository *
                                </label>
                                <input
                                    type="text"
                                    value={azureRepo}
                                    onChange={(e) => setAzureRepo(e.target.value)}
                                    placeholder="e.g., my-repo"
	                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                />
                            </div>
                            <div>
	                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Personal Access Token (PAT) *
                                </label>
                                <input
                                    type="password"
                                    value={azurePat}
                                    onChange={(e) => setAzurePat(e.target.value)}
                                    placeholder="Azure DevOps PAT with Code (Read) scope"
	                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                />
	                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    Create at: dev.azure.com/{azureOrg || '{org}'}/_usersSettings/tokens
                                </p>
                            </div>
                        </div>
                    </div>

	                    {/* GitHub Target */}
	                    <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
	                        <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-3">GitHub Target</h3>
                        <div className="space-y-3">
                            <div>
	                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Target Organization (optional)
                                </label>
                                <Select
                                    value={targetOrg}
                                    onChange={setTargetOrg}
                                    options={[
                                        { value: '', label: 'My personal account' },
                                        ...(orgs?.map((org) => ({
                                            value: org.login,
                                            label: org.login
                                        })) || [])
                                    ]}
                                />
                            </div>
                            <div>
	                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Repository Name (optional)
                                </label>
                                <input
                                    type="text"
                                    value={targetRepoName}
                                    onChange={(e) => setTargetRepoName(e.target.value)}
                                    placeholder={azureRepo || 'Same as source'}
	                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                                />
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={makePrivate}
                                    onChange={(e) => setMakePrivate(e.target.checked)}
                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                                />
	                                <span className="text-sm text-slate-700 dark:text-slate-300">Make repository private</span>
                            </label>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!isValid || isPerforming} className="flex-1">
                            {isPerforming ? 'Importing...' : '🚀 Start Import'}
                        </Button>
                    </div>
                </form>
            </Card>
        </div>
    )
}

