import { useState } from 'react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'

export function CreateRepoModal({ isOpen, onClose, onCreate, orgs, isPerforming }) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [targetOrg, setTargetOrg] = useState('')
    const [isPrivate, setIsPrivate] = useState(true)

    if (!isOpen) return null

    const handleSubmit = async (e) => {
        e.preventDefault()
        const result = await onCreate(name, {
            description,
            org: targetOrg || undefined,
            private: isPrivate
        })
        if (result?.success) {
            onClose()
            setName('')
            setDescription('')
            setTargetOrg('')
        }
    }

	    return (
	        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <Card className="w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <span className="text-2xl">📦</span>
                        Create Repository
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-2xl">
                        ×
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Owner
                        </label>
                        <select
                            value={targetOrg}
                            onChange={(e) => setTargetOrg(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">My personal account</option>
                            {orgs?.map((org) => (
                                <option key={org.login} value={org.login}>
                                    {org.login}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Repository Name *
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))}
                            placeholder="my-awesome-project"
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Description (optional)
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="A short description of your repository"
                            rows={2}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                        />
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isPrivate}
                            onChange={(e) => setIsPrivate(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Private repository</span>
                    </label>

                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!name || isPerforming} className="flex-1">
                            {isPerforming ? 'Creating...' : 'Create Repository'}
                        </Button>
                    </div>
                </form>
            </Card>
        </div>
    )
}

