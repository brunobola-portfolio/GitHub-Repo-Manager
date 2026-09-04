import { motion } from 'framer-motion';
import { TRANSITION } from './motion';

const VARIANT_CONTAINER = {
    pill: 'flex gap-1 p-1 rounded-2xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/40 dark:border-slate-700/40',
    underline: 'flex border-b border-slate-200/50 dark:border-slate-800/40',
    segmented: 'flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 overflow-hidden',
};

const VARIANT_BUTTON = {
    pill: {
        active: 'text-slate-900 dark:text-slate-100',
        // slate-500 measured 4.43:1 on the pill container's tinted
        // bg-slate-100/80 ground in light mode — axe flagged it on the team
        // detail page. slate-600 clears AA on the tint; dark is unaffected.
        inactive: 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200',
    },
    underline: {
        active: 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]',
        inactive: 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
    },
    segmented: {
        active: 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 rounded-md',
        inactive: 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800',
    },
};

const VARIANT_INDICATOR = {
    pill: 'absolute inset-0 rounded-xl bg-white dark:bg-slate-700 shadow-sm',
    underline: 'absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500 rounded-full',
    segmented: null,
};

const SIZE_CLASSES = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
};

export function TabBar({ tabs, activeTab, onTabChange, variant = 'pill', layoutId, className = '', size = 'md', ariaLabel }) {
    const handleKeyDown = (e) => {
        const currentIndex = tabs.findIndex(t => t.id === activeTab);
        let nextIndex;

        switch (e.key) {
            case 'ArrowRight':
                nextIndex = (currentIndex + 1) % tabs.length;
                break;
            case 'ArrowLeft':
                nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = tabs.length - 1;
                break;
            default:
                return;
        }

        e.preventDefault();
        onTabChange(tabs[nextIndex].id);
        document.getElementById(`tab-${layoutId}-${tabs[nextIndex].id}`)?.focus();
    };

    const indicatorClass = VARIANT_INDICATOR[variant];

    return (
        <div
            role="tablist"
            aria-label={ariaLabel}
            tabIndex={0}
            className={`${VARIANT_CONTAINER[variant]} ${className} ds-focus-ring rounded-lg`}
            onKeyDown={handleKeyDown}
        >
            {tabs.map(({ id, label, icon: Icon, trailing, badge }) => {
                const isActive = activeTab === id;
                const buttonStyle = VARIANT_BUTTON[variant];
                return (
                    <button
                        key={id}
                        id={`tab-${layoutId}-${id}`}
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        aria-controls={`tabpanel-${layoutId}-${id}`}
                        onClick={() => onTabChange(id)}
                        className={`relative flex items-center gap-1.5 ${SIZE_CLASSES[size]} font-medium whitespace-nowrap transition-colors ${
                            isActive ? buttonStyle.active : buttonStyle.inactive
                        }`}
                    >
                        {isActive && indicatorClass && (
                            <motion.div
                                layoutId={layoutId}
                                className={indicatorClass}
                                transition={TRANSITION.standard}
                            />
                        )}
                        <span className={indicatorClass ? 'relative z-10 flex items-center gap-1.5' : 'flex items-center gap-1.5'}>
                            {Icon && <Icon className="w-4 h-4" />}
                            {label}
                            {badge}
                            {trailing}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
