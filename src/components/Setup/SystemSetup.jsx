import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, CheckCircle, Server, HardDrive, ShieldCheck, ArrowRight } from 'lucide-react';
import { Spinner } from '../ui/Spinner';
import { PageHeader } from '../ui/PageHeader';
import { getCsrfToken } from '../../utils/api';

export function SystemSetup({ onComplete }) {
    const [step, setStep] = useState(0);
    const [completed, setCompleted] = useState(false);
    const [error, setError] = useState(null);

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const startSetup = async () => {
        // Step 1: Connecting
        await wait(1000);
        setStep(1);

        // Step 2: Request Backend Setup
        try {
            setError(null);
            const headers = {};
            try { headers['X-CSRF-Token'] = await getCsrfToken(); } catch { /* server will 403 */ }
            const res = await fetch('/api/system/setup', {
                method: 'POST',
                credentials: 'include',
                headers,
            });
            if (!res.ok) throw new Error('Setup failed');

            // Step 2 -> 3 (Simulate progress matching backend simulation)
            await wait(1000);
            setStep(2);

            await wait(1000);
            setStep(3);

            await wait(1000);
            setStep(4);

            await wait(800);
            setCompleted(true);
        } catch (e) {
            setError(e?.message || 'System setup failed. Please try again.');
        }
    };

    /* eslint-disable react-hooks/set-state-in-effect -- one-shot bootstrap on mount */
    useEffect(() => {
        startSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    /* eslint-enable react-hooks/set-state-in-effect */

    return (
        <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-[var(--ds-z-popover)] text-white overflow-hidden">
            {/* Background Effects */}
            <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px]" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px]" />

            <div className="relative w-full max-w-lg p-8">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center mb-12"
                >
                    <div className="w-20 h-20 bg-indigo-600 dark:bg-indigo-500 rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-xl">
                        <Database className="w-10 h-10 text-white" />
                    </div>
                    <PageHeader
                        title="Initialize System"
                        description="Setting up your portable workspace."
                        align="center"
                        className="mb-0 flex-col sm:flex-col sm:items-center"
                    />
                </motion.div>

                <div className="space-y-6">
                    <SetupStep
                        label="Establishing Connection"
                        icon={Server}
                        status={step > 0 ? 'done' : step === 0 ? 'active' : 'pending'}
                    />
                    <SetupStep
                        label="Creating SQLite Database"
                        icon={HardDrive}
                        status={step > 1 ? 'done' : step === 1 ? 'active' : 'pending'}
                    />
                    <SetupStep
                        label="Running Migrations"
                        icon={Database}
                        status={step > 2 ? 'done' : step === 2 ? 'active' : 'pending'}
                    />
                    <SetupStep
                        label="Verifying Security"
                        icon={ShieldCheck}
                        status={step > 3 ? 'done' : step === 3 ? 'active' : 'pending'}
                    />
                </div>

                {error && (
                    <div className="mt-8 px-4 py-3 bg-red-950/30 border border-red-800/50 rounded-xl text-sm text-red-400">
                        {error}
                        <button
                            onClick={() => { setStep(0); setError(null); startSetup(); }}
                            className="ml-3 underline hover:text-red-300 transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                )}

                <AnimatePresence>
                    {completed && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-12"
                        >
                            <button
                                onClick={onComplete}
                                className="w-full py-4 bg-white text-slate-900 rounded-xl font-bold text-lg hover:bg-slate-100 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-white/10"
                            >
                                <span>Launch Workspace</span>
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

function SetupStep({ label, icon: Icon, status }) {
    return (
        <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-500 ${status === 'active'
                ? 'bg-white/10 border-white/20'
                : 'border-transparent'
            }`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-500 ${status === 'done' ? 'bg-green-500 text-white' :
                    status === 'active' ? 'bg-indigo-500 text-white' :
                        'bg-slate-800 text-slate-600'
                }`}>
                {status === 'done' ? (
                    <CheckCircle className="w-5 h-5" />
                ) : status === 'active' ? (
                    <Spinner size="lg" tone="primary" />
                ) : (
                    <Icon className="w-5 h-5" />
                )}
            </div>
            <div className="flex-1">
                <span className={`font-medium transition-colors duration-300 ${status === 'pending' ? 'text-slate-600' : 'text-white'
                    }`}>
                    {label}
                </span>
            </div>
        </div>
    );
}
