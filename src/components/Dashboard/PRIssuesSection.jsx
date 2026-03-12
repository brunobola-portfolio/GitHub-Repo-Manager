import React from 'react'
import { motion } from 'framer-motion'
import { GitPullRequest, GitMerge, MessageSquare, AlertCircle } from 'lucide-react'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'

/**
 * PRIssuesSection - Pull Requests and Issues statistics
 */
export function PRIssuesSection() {
    // Placeholder for future implementation
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* PR Stats */}
                <motion.div whileHover={{ y: -3 }}>
                    <Card className="p-6 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 hover:shadow-xl hover:border-pink-400/50 dark:hover:border-pink-500/40 transition-all">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center">
                                <GitPullRequest className="w-5 h-5 text-pink-500" />
                            </div>
                            <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                                Pull Requests
                            </h4>
                        </div>
                        <EmptyState
                            icon={GitMerge}
                            title="Coming Soon"
                            description="PR velocity, merge time, and review metrics"
                            gradient="from-pink-500 to-rose-600"
                        />
                    </Card>
                </motion.div>

                {/* Issues Stats */}
                <motion.div whileHover={{ y: -3 }}>
                    <Card className="p-6 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 hover:shadow-xl hover:border-blue-400/50 dark:hover:border-blue-500/40 transition-all">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                                <AlertCircle className="w-5 h-5 text-blue-500" />
                            </div>
                            <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                                Issues
                            </h4>
                        </div>
                        <EmptyState
                            icon={MessageSquare}
                            title="Coming Soon"
                            description="Issue resolution time and tracking"
                            gradient="from-blue-500 to-cyan-600"
                        />
                    </Card>
                </motion.div>
            </div>
        </div>
    )
}
