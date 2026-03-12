import React from 'react'
import { motion } from 'framer-motion'
import { Heart, Shield, FileCheck, TrendingUp } from 'lucide-react'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'

/**
 * HealthSection - Repository health and quality metrics
 */
export function HealthSection() {
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Health Score */}
                <motion.div whileHover={{ scale: 1.02, y: -4 }}>
                    <Card className="p-6 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 hover:shadow-xl hover:border-emerald-400/50 dark:hover:border-emerald-500/40 transition-all">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                                <Heart className="w-5 h-5 text-emerald-500" />
                            </div>
                            <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                                Health Score
                            </h4>
                        </div>
                        <EmptyState
                            icon={TrendingUp}
                            title="Coming Soon"
                            description="Average health score across repositories"
                            gradient="from-emerald-500 to-teal-600"
                        />
                    </Card>
                </motion.div>

                {/* Security */}
                <motion.div whileHover={{ scale: 1.02, y: -4 }}>
                    <Card className="p-6 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 hover:shadow-xl hover:border-orange-400/50 dark:hover:border-orange-500/40 transition-all">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                                <Shield className="w-5 h-5 text-orange-500" />
                            </div>
                            <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                                Security
                            </h4>
                        </div>
                        <EmptyState
                            icon={Shield}
                            title="Coming Soon"
                            description="Security policies and vulnerability alerts"
                            gradient="from-orange-500 to-red-600"
                        />
                    </Card>
                </motion.div>

                {/* Documentation */}
                <motion.div whileHover={{ scale: 1.02, y: -4 }}>
                    <Card className="p-6 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 hover:shadow-xl hover:border-purple-400/50 dark:hover:border-purple-500/40 transition-all">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                                <FileCheck className="w-5 h-5 text-purple-500" />
                            </div>
                            <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                                Documentation
                            </h4>
                        </div>
                        <EmptyState
                            icon={FileCheck}
                            title="Coming Soon"
                            description="README, LICENSE, and contributing files"
                            gradient="from-purple-500 to-indigo-600"
                        />
                    </Card>
                </motion.div>
            </div>
        </div>
    )
}
