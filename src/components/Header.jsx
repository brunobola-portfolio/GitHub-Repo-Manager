import { Github, LogOut, RefreshCw, FlaskConical, LayoutDashboard, FolderGit2, Plus, Cloud } from 'lucide-react'
import { Button } from './ui/Button'

export function Header({
    user,
    isMockMode,
    onLogin,
    onLogout,
    onCheck,
    onAzureImport,
    onCreateRepo,
    activeView,
    onViewChange
}) {
    return (
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-600 p-2 rounded-lg">
                        <Github className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 leading-none">
                            GitHub Repo Manager
                        </h1>
                        <p className="text-xs text-slate-500">Organize & migrate your repositories</p>
                    </div>
                    {isMockMode && (
                        <div className="flex items-center gap-1 bg-amber-100 text-amber-700 px-2 py-1 rounded-full text-xs font-medium">
                            <FlaskConical className="w-3 h-3" />
                            Demo Mode
                        </div>
                    )}
                </div>

                {/* Navigation */}
                {user && (
                    <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                        <button
                            onClick={() => onViewChange?.('dashboard')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                activeView === 'dashboard'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            <LayoutDashboard className="w-4 h-4" />
                            Dashboard
                        </button>
                        <button
                            onClick={() => onViewChange?.('repos')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                activeView === 'repos'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            <FolderGit2 className="w-4 h-4" />
                            Repositories
                        </button>
                    </nav>
                )}

                <div className="flex items-center gap-3">
                    {user ? (
                        <>
                            {/* Action Buttons */}
                            <div className="flex items-center gap-2">
                                <Button variant="secondary" size="sm" onClick={onCreateRepo} title="Create new repository">
                                    <Plus className="w-4 h-4 mr-1" />
                                    New Repo
                                </Button>
                                <Button variant="info" size="sm" onClick={onAzureImport} title="Import from Azure DevOps">
                                    <Cloud className="w-4 h-4 mr-1" />
                                    Azure Import
                                </Button>
                            </div>

                            {/* User Info */}
                            <div className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200">
                                <img
                                    src={user.avatar_url || 'https://github.com/ghost.png'}
                                    alt={user.login}
                                    className="w-5 h-5 rounded-full"
                                />
                                <span className="font-medium">{user.login}</span>
                            </div>
                            {!isMockMode && (
                                <Button variant="ghost" size="sm" onClick={onLogout} title="Logout">
                                    <LogOut className="w-4 h-4" />
                                </Button>
                            )}
                        </>
                    ) : (
                        <div className="flex gap-2">
                            <Button variant="secondary" size="sm" onClick={onCheck}>
                                <RefreshCw className="w-4 h-4 mr-1" />
                                Check Status
                            </Button>
                            <Button variant="primary" size="sm" onClick={onLogin}>
                                <Github className="w-4 h-4 mr-1" />
                                Login with GitHub
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    )
}
