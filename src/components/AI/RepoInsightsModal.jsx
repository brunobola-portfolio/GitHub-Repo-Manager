import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Brain, Lightbulb, Loader2, FileText, CheckCircle2, AlertCircle, BarChart3 } from 'lucide-react';
import { aiApi } from '../../api/ai';

const RepoInsightsModal = ({ repo, isOpen, onClose }) => {
    const [analysis, setAnalysis] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('overview'); // overview, quality, readme

    useEffect(() => {
        if (isOpen && repo) {
            fetchAnalysis();
            setActiveTab('overview');
        } else {
            setAnalysis(null);
            setError(null);
        }
    }, [isOpen, repo]);

    const fetchAnalysis = async () => {
        setLoading(true);
        setError(null);
        try {
            // 1. Try to get cached metadata first
            let data = await aiApi.getMetadata(repo.id);

            // 2. If no data, trigger indexing (Auto-analyze on first view)
            if (!data) {
                const indexResult = await aiApi.indexRepo(repo);
                data = indexResult.analysis;
            } else {
                // Parse JSON strings if coming from DB
                if (typeof data.topics === 'string') data.suggested_topics = JSON.parse(data.topics);
                if (data.topics && !data.suggested_topics) data.suggested_topics = JSON.parse(data.topics);
            }

            setAnalysis(data);
        } catch (err) {
            console.error(err);
            setError('Failed to generate insights. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const reanalyze = async () => {
        setLoading(true);
        try {
            const indexResult = await aiApi.indexRepo(repo);
            setAnalysis(indexResult.analysis);
        } catch (err) {
            setError('Re-analysis failed');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const tabs = [
        { id: 'overview', label: 'Overview', icon: Sparkles },
        { id: 'quality', label: 'Quality', icon: BarChart3 },
        { id: 'readme', label: 'README', icon: FileText }
    ];

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-[#1C1C1E] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-6 border-b border-white/10 bg-[#2C2C2E]/50">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-500/20 rounded-lg">
                                <Sparkles className="w-6 h-6 text-purple-400" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white">AI Insights</h2>
                                <p className="text-sm text-gray-400">{repo?.full_name}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                            <X className="w-5 h-5 text-gray-400" />
                        </button>
                    </div>

                    {/* Tabs */}
                    {analysis && !loading && (
                        <div className="flex border-b border-white/10 px-4 bg-[#2C2C2E]/30">
                            {tabs.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                                        activeTab === tab.id
                                            ? 'text-purple-400 border-purple-400'
                                            : 'text-gray-400 border-transparent hover:text-white'
                                    }`}
                                >
                                    <tab.icon className="w-4 h-4" />
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Content */}
                    <div className="p-6 max-h-[60vh] overflow-y-auto">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-12 space-y-4">
                                <Loader2 className="w-10 h-10 text-purple-500 animate-spin" />
                                <p className="text-gray-400 animate-pulse">Analyzing repository structure & docs...</p>
                            </div>
                        ) : error ? (
                            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
                                <p className="text-red-400 mb-4">{error}</p>
                                <button onClick={fetchAnalysis} className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-colors">
                                    Retry
                                </button>
                            </div>
                        ) : analysis ? (
                            <div className="space-y-6">
                                {/* Overview Tab */}
                                {activeTab === 'overview' && (
                                    <>
                                        {/* Health Score */}
                                        <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-3 rounded-full ${getScoreColor(analysis.health_score)}`}>
                                                    <Brain className="w-6 h-6 text-white" />
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-semibold text-white">Health Score</h3>
                                                    <p className="text-sm text-gray-400">Based on docs, structure & metadata</p>
                                                </div>
                                            </div>
                                            <div className="text-4xl font-bold text-white">
                                                {analysis.health_score}<span className="text-xl text-gray-500">/100</span>
                                            </div>
                                        </div>

                                        {/* TL;DR */}
                                        <div className="space-y-2">
                                            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">TL;DR Summary</h3>
                                            <p className="text-gray-200 leading-relaxed bg-white/5 p-4 rounded-xl border border-white/5">
                                                {analysis.summary}
                                            </p>
                                        </div>

                                        {/* Highlights */}
                                        {analysis.highlights?.length > 0 && (
                                            <div className="space-y-2">
                                                <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Highlights</h3>
                                                <div className="grid gap-2">
                                                    {analysis.highlights.map((h, i) => (
                                                        <div key={i} className="flex items-center gap-2 text-green-400 text-sm">
                                                            <CheckCircle2 className="w-4 h-4" />
                                                            <span>{h}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Suggested Topics */}
                                        {analysis.suggested_topics?.length > 0 && (
                                            <div className="space-y-2">
                                                <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Suggested Topics</h3>
                                                <div className="flex flex-wrap gap-2">
                                                    {analysis.suggested_topics.map((topic, i) => (
                                                        <span key={i} className="px-3 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-sm">
                                                            #{topic}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Quality Tab */}
                                {activeTab === 'quality' && (
                                    <>
                                        {/* Quality Breakdown */}
                                        {analysis.quality_breakdown && (
                                            <div className="space-y-4">
                                                <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Quality Breakdown</h3>
                                                <div className="grid gap-3">
                                                    {Object.entries(analysis.quality_breakdown).map(([key, value]) => (
                                                        <div key={key} className="space-y-1">
                                                            <div className="flex justify-between text-sm">
                                                                <span className="text-gray-300 capitalize">{key}</span>
                                                                <span className="text-gray-400">{value}/30</span>
                                                            </div>
                                                            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                                                <div
                                                                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full"
                                                                    style={{ width: `${(value / 30) * 100}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Improvements */}
                                        {analysis.improvements?.length > 0 && (
                                            <div className="space-y-2">
                                                <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Recommendations</h3>
                                                <div className="grid gap-3">
                                                    {analysis.improvements.map((imp, i) => (
                                                        <div key={i} className="flex items-start gap-3 p-3 bg-yellow-500/5 border border-yellow-500/10 rounded-lg">
                                                            <Lightbulb className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
                                                            <p className="text-gray-300 text-sm">{imp}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Patterns */}
                                        {analysis.patterns && (
                                            <div className="space-y-2">
                                                <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Detected Features</h3>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {Object.entries(analysis.patterns).filter(([k]) => k.startsWith('has')).map(([key, value]) => (
                                                        <div key={key} className={`flex items-center gap-2 text-sm ${value ? 'text-green-400' : 'text-gray-500'}`}>
                                                            {value ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                                                            <span>{key.replace('has', '').replace(/([A-Z])/g, ' $1').trim()}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* README Tab */}
                                {activeTab === 'readme' && (
                                    <>
                                        {analysis.readme_suggestions?.length > 0 ? (
                                            <div className="space-y-4">
                                                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                                                    <h3 className="text-blue-400 font-medium mb-2">README Enhancement Suggestions</h3>
                                                    <p className="text-gray-400 text-sm">These sections could improve your documentation:</p>
                                                </div>
                                                <div className="grid gap-2">
                                                    {analysis.readme_suggestions.map((section, i) => (
                                                        <div key={i} className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-lg">
                                                            <FileText className="w-5 h-5 text-purple-400" />
                                                            <span className="text-gray-200">{section}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-center">
                                                <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
                                                <p className="text-green-400">README looks complete!</p>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        ) : null}
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-white/10 bg-[#2C2C2E]/30 flex justify-end gap-3">
                        <button
                            onClick={reanalyze}
                            disabled={loading}
                            className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                        >
                            Re-analyze
                        </button>
                        <button
                            onClick={onClose}
                            className="px-6 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors"
                        >
                            Done
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

const getScoreColor = (score) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
};

export default RepoInsightsModal;
