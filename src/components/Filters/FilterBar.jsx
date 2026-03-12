import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Filter, X, ChevronDown, Check, Calendar, Star, GitFork } from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'

/**
 * FilterBar - Premium filter system with multi-select, ranges, and presets
 */
export function FilterBar({ onFilterChange }) {
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [activeFilters, setActiveFilters] = useState({})

    const hasActiveFilters = Object.keys(activeFilters).length > 0

    const handleFilterChange = (key, value) => {
        const newFilters = { ...activeFilters }

        if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
            delete newFilters[key]
        } else {
            newFilters[key] = value
        }

        setActiveFilters(newFilters)
        onFilterChange?.(newFilters)
    }

    const clearAllFilters = () => {
        setActiveFilters({})
        onFilterChange?.({})
    }

    const getActiveCount = () => Object.keys(activeFilters).length

    return (
        <div className="space-y-4">
            {/* Main Filter Bar */}
            <div className="flex flex-wrap items-center gap-3 p-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/60 dark:border-slate-700/40 rounded-2xl shadow-lg">
                {/* Filter Icon & Title */}
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <Filter className="w-5 h-5 text-indigo-500" />
                    <span className="font-semibold">Filters</span>
                    {hasActiveFilters && (
                        <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                            {getActiveCount()}
                        </span>
                    )}
                </div>

                <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

                {/* Quick Filters */}
                <div className="flex flex-wrap items-center gap-2">
                    <FilterDropdown
                        label="Time Range"
                        icon={Calendar}
                        value={activeFilters.timeRange}
                        options={[
                            { value: '7d', label: 'Last 7 days' },
                            { value: '30d', label: 'Last 30 days' },
                            { value: '90d', label: 'Last 3 months' },
                            { value: '1y', label: 'Last year' }
                        ]}
                        onChange={(val) => handleFilterChange('timeRange', val)}
                    />

                    <FilterMultiSelect
                        label="Type"
                        value={activeFilters.type || []}
                        options={[
                            { value: 'all', label: 'All' },
                            { value: 'public', label: 'Public' },
                            { value: 'private', label: 'Private' },
                            { value: 'forked', label: 'Forked' },
                            { value: 'source', label: 'Source' },
                            { value: 'archived', label: 'Archived' }
                        ]}
                        onChange={(val) => handleFilterChange('type', val)}
                    />

                    <FilterMultiSelect
                        label="Language"
                        value={activeFilters.language || []}
                        options={[
                            { value: 'javascript', label: 'JavaScript' },
                            { value: 'typescript', label: 'TypeScript' },
                            { value: 'python', label: 'Python' },
                            { value: 'go', label: 'Go' },
                            { value: 'rust', label: 'Rust' },
                            { value: 'java', label: 'Java' }
                        ]}
                        onChange={(val) => handleFilterChange('language', val)}
                    />
                </div>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Actions */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                    >
                        Advanced {showAdvanced ? '↑' : '↓'}
                    </button>

                    {hasActiveFilters && (
                        <button
                            onClick={clearAllFilters}
                            className="px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                            Clear All
                        </button>
                    )}
                </div>
            </div>

            {/* Active Filter Pills */}
            {hasActiveFilters && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex flex-wrap gap-2"
                >
                    {Object.entries(activeFilters).map(([key, value]) => (
                        <FilterPill
                            key={key}
                            label={key}
                            value={value}
                            onRemove={() => handleFilterChange(key, null)}
                        />
                    ))}
                </motion.div>
            )}

            {/* Advanced Filters */}
            <AnimatePresence>
                {showAdvanced && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3 }}
                        className="p-6 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-slate-200/40 dark:border-slate-700/30 rounded-2xl"
                    >
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4 uppercase tracking-wider">
                            Advanced Filters
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {/* Stars Range */}
                            <RangeFilter
                                label="Stars"
                                icon={Star}
                                min={0}
                                max={10000}
                                value={activeFilters.starsRange || [0, 10000]}
                                onChange={(val) => handleFilterChange('starsRange', val)}
                            />

                            {/* Forks Range */}
                            <RangeFilter
                                label="Forks"
                                icon={GitFork}
                                min={0}
                                max={1000}
                                value={activeFilters.forksRange || [0, 1000]}
                                onChange={(val) => handleFilterChange('forksRange', val)}
                            />

                            {/* Has Issues Toggle */}
                            <ToggleFilter
                                label="Has Issues"
                                value={activeFilters.hasIssues}
                                onChange={(val) => handleFilterChange('hasIssues', val)}
                            />

                            {/* Has PRs Toggle */}
                            <ToggleFilter
                                label="Has PRs"
                                value={activeFilters.hasPRs}
                                onChange={(val) => handleFilterChange('hasPRs', val)}
                            />

                            {/* Has Actions Toggle */}
                            <ToggleFilter
                                label="Has Actions"
                                value={activeFilters.hasActions}
                                onChange={(val) => handleFilterChange('hasActions', val)}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

/**
 * FilterDropdown - Single select dropdown
 */
function FilterDropdown({ label, icon: Icon, value, options, onChange }) {
    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button className="px-3 py-1.5 text-sm font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-2">
                    {Icon && <Icon className="w-4 h-4" />}
                    {label}
                    <ChevronDown className="w-3 h-3" />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    className="w-48 p-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50"
                    sideOffset={8}
                >
                    <div className="space-y-1">
                        {options.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => onChange(opt.value)}
                                className={`w-full px-3 py-2 text-sm text-left rounded-lg transition-colors flex items-center justify-between ${
                                    value === opt.value
                                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                            >
                                {opt.label}
                                {value === opt.value && <Check className="w-4 h-4" />}
                            </button>
                        ))}
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}

/**
 * FilterMultiSelect - Multiple selection dropdown
 */
function FilterMultiSelect({ label, value = [], options, onChange }) {
    const toggleOption = (optValue) => {
        const newValue = value.includes(optValue)
            ? value.filter(v => v !== optValue)
            : [...value, optValue]
        onChange(newValue)
    }

    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button className="px-3 py-1.5 text-sm font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-2">
                    {label}
                    {value.length > 0 && (
                        <span className="px-1.5 py-0.5 text-xs font-bold rounded-full bg-indigo-500 text-white">
                            {value.length}
                        </span>
                    )}
                    <ChevronDown className="w-3 h-3" />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    className="w-48 p-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50"
                    sideOffset={8}
                >
                    <div className="space-y-1">
                        {options.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => toggleOption(opt.value)}
                                className={`w-full px-3 py-2 text-sm text-left rounded-lg transition-colors flex items-center justify-between ${
                                    value.includes(opt.value)
                                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                            >
                                {opt.label}
                                {value.includes(opt.value) && <Check className="w-4 h-4" />}
                            </button>
                        ))}
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}

/**
 * FilterPill - Active filter display
 */
function FilterPill({ label, value, onRemove }) {
    const displayValue = Array.isArray(value) ? value.join(', ') : value

    return (
        <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-medium flex items-center gap-2"
        >
            <span className="font-semibold">{label}:</span>
            <span className="truncate max-w-[200px]">{displayValue}</span>
            <button
                onClick={onRemove}
                className="hover:bg-indigo-200 dark:hover:bg-indigo-900/50 rounded-full p-0.5 transition-colors"
            >
                <X className="w-3 h-3" />
            </button>
        </motion.div>
    )
}

/**
 * RangeFilter - Min/Max range selector
 */
function RangeFilter({ label, icon: Icon, min, max, value, onChange }) {
    return (
        <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {label}
            </label>
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    min={min}
                    max={max}
                    value={value[0]}
                    onChange={(e) => onChange([parseInt(e.target.value), value[1]])}
                    className="w-24 px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Min"
                />
                <span className="text-slate-400">to</span>
                <input
                    type="number"
                    min={min}
                    max={max}
                    value={value[1]}
                    onChange={(e) => onChange([value[0], parseInt(e.target.value)])}
                    className="w-24 px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Max"
                />
            </div>
        </div>
    )
}

/**
 * ToggleFilter - Boolean toggle
 */
function ToggleFilter({ label, value, onChange }) {
    return (
        <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {label}
            </label>
            <button
                onClick={() => onChange(value === undefined ? true : value === true ? false : undefined)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    value === true
                        ? 'bg-indigo-500'
                        : value === false
                        ? 'bg-red-500'
                        : 'bg-slate-300 dark:bg-slate-600'
                }`}
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        value === true ? 'translate-x-6' : value === false ? 'translate-x-1' : 'translate-x-3'
                    }`}
                />
            </button>
        </div>
    )
}
