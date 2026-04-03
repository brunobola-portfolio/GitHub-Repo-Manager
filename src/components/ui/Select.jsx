import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Check, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

/**
 * Custom Select Component with sections, badges, search, skeleton, and footer.
 *
 * @param {Object} props
 * @param {Array} props.options - Array of { value, label, badge?, badgeColor?, icon?, disabled?, muted? }
 * @param {Array} [props.sections] - Array of { title, options: [...] } for grouped display
 * @param {string} props.value - Selected value
 * @param {Function} props.onChange - Change handler (receives value)
 * @param {string} props.placeholder - Placeholder text
 * @param {string} props.className - Additional classes
 * @param {boolean} props.disabled - Disabled state
 * @param {string} props.size - Size variant: 'sm', 'md', 'lg'
 * @param {string} props.label - ARIA label
 * @param {boolean} props.searchable - Show search input
 * @param {string} props.footer - Footer text
 * @param {boolean} props.loading - Show skeleton loading state
 * @param {number} props.skeletonCount - Number of skeleton items (default 3)
 * @param {React.ReactNode} props.emptyState - Custom empty state content
 * @param {React.ReactNode} props.errorState - Custom error state content
 * @param {Function} props.onOpen - Called when dropdown opens
 * @param {React.ReactNode} props.extraOption - Extra option rendered at the bottom (e.g. "Type manually...")
 */
export function Select({
    options = [],
    sections,
    value,
    onChange,
    placeholder = 'Select...',
    className = '',
    disabled = false,
    size = 'md',
    label = 'Select',
    searchable = false,
    footer,
    loading = false,
    skeletonCount = 3,
    emptyState,
    errorState,
    onOpen,
    extraOption,
}) {
    const [isOpen, setIsOpen] = useState(false)
    const [focusedIndex, setFocusedIndex] = useState(0)
    const [searchQuery, setSearchQuery] = useState('')
    const selectRef = useRef(null)
    const listRef = useRef(null)
    const searchRef = useRef(null)

    // Flatten sections into options if sections provided
    const allOptions = useMemo(() => {
        if (sections) {
            return sections.flatMap(s => s.options || [])
        }
        return options
    }, [sections, options])

    // Filter by search
    const filteredSections = useMemo(() => {
        const q = searchQuery.toLowerCase().trim()
        if (sections) {
            if (!q) return sections
            return sections
                .map(s => ({
                    ...s,
                    options: (s.options || []).filter(opt =>
                        opt.label.toLowerCase().includes(q) ||
                        (opt.badge && String(opt.badge).toLowerCase().includes(q))
                    ),
                }))
                .filter(s => s.options.length > 0)
        }
        if (!q) return null // signal: use options directly
        return null
    }, [sections, searchQuery])

    const filteredOptions = useMemo(() => {
        const q = searchQuery.toLowerCase().trim()
        if (sections) {
            return (filteredSections || []).flatMap(s => s.options || [])
        }
        if (!q) return options
        return options.filter(opt =>
            opt.label.toLowerCase().includes(q) ||
            (opt.badge && String(opt.badge).toLowerCase().includes(q))
        )
    }, [options, sections, filteredSections, searchQuery])

    const selectedOption = allOptions.find(opt => opt.value === value)

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (selectRef.current && !selectRef.current.contains(event.target)) {
                setIsOpen(false)
                setSearchQuery('')
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    // Focus search input when opened
    useEffect(() => {
        if (isOpen && searchable && searchRef.current) {
            searchRef.current.focus()
        }
    }, [isOpen, searchable])

    // Auto-scroll focused option into view
    useEffect(() => {
        if (isOpen && focusedIndex >= 0 && listRef.current) {
            const optionElement = listRef.current.querySelector(`[data-index="${focusedIndex}"]`)
            if (optionElement) {
                optionElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            }
        }
    }, [focusedIndex, isOpen])

    // Size variants
    const sizeClasses = {
        sm: 'px-2.5 py-1.5 text-xs',
        md: 'px-3 py-2 text-sm',
        lg: 'px-4 py-2.5 text-base'
    }

    const handleOpen = () => {
        if (disabled) return
        const opening = !isOpen
        setIsOpen(opening)
        if (opening) {
            setSearchQuery('')
            const currentIndex = filteredOptions.findIndex(opt => opt.value === value)
            setFocusedIndex(currentIndex >= 0 ? currentIndex : 0)
            onOpen?.()
        }
    }

    const handleSelect = (optionValue) => {
        onChange?.(optionValue)
        setIsOpen(false)
        setSearchQuery('')
    }

    // Keyboard navigation handler
    const handleKeyDown = (e) => {
        if (!isOpen) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault()
                handleOpen()
            }
            return
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                setFocusedIndex(prev => Math.min(prev + 1, filteredOptions.length - 1))
                break
            case 'ArrowUp':
                e.preventDefault()
                setFocusedIndex(prev => Math.max(prev - 1, 0))
                break
            case 'Enter':
                e.preventDefault()
                if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
                    const opt = filteredOptions[focusedIndex]
                    if (!opt.disabled) handleSelect(opt.value)
                }
                break
            case 'Escape':
                e.preventDefault()
                setIsOpen(false)
                setSearchQuery('')
                break
            case 'Home':
                e.preventDefault()
                setFocusedIndex(0)
                break
            case 'End':
                e.preventDefault()
                setFocusedIndex(filteredOptions.length - 1)
                break
            default:
                break
        }
    }

    // Render an individual option row
    const renderOption = (option, globalIndex) => {
        const isSelected = option.value === value
        const isFocused = globalIndex === focusedIndex
        const IconComponent = option.icon

        return (
            <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-index={globalIndex}
                disabled={option.disabled}
                onClick={() => !option.disabled && handleSelect(option.value)}
                onMouseEnter={() => setFocusedIndex(globalIndex)}
                className={`
                    w-full flex items-center justify-between gap-2
                    px-3 py-2.5
                    text-left text-sm font-medium
                    transition-all duration-150
                    focus:outline-none
                    ${option.disabled
                        ? 'opacity-40 cursor-not-allowed'
                        : option.muted
                        ? 'opacity-60'
                        : ''}
                    ${isSelected
                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                        : isFocused
                        ? 'bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }
                `}
            >
                <span className="flex items-center gap-2 min-w-0">
                    {IconComponent && <IconComponent className="w-4 h-4 text-slate-400 shrink-0" />}
                    <span className="truncate">{option.label}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                    {option.badge !== undefined && option.badge !== null && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                            option.badgeColor || 'text-slate-500 dark:text-slate-400'
                        }`}>
                            {option.badge === -1 ? '—' : option.badge}
                        </span>
                    )}
                    {isSelected && <Check className="w-4 h-4 text-indigo-500" />}
                </span>
            </button>
        )
    }

    // Pre-compute stable global indices for sections
    const indexedSections = useMemo(() => {
        let idx = 0
        return (filteredSections || sections || []).map(s => ({
            ...s,
            options: (s.options || []).map(opt => ({ ...opt, _globalIndex: idx++ }))
        }))
    }, [filteredSections, sections])

    return (
        <div ref={selectRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
            {/* Select Trigger */}
            <button
                type="button"
                disabled={disabled}
                onClick={handleOpen}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-label={label}
                className={`
                    w-full flex items-center justify-between gap-2
                    ${sizeClasses[size]}
                    bg-white/80 dark:bg-slate-800/80
                    backdrop-blur-xl
                    border border-slate-200 dark:border-slate-700
                    rounded-xl
                    font-medium
                    text-slate-700 dark:text-slate-200
                    transition-all duration-200
                    focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900
                    ${disabled
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-white dark:hover:bg-slate-800 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:shadow-md cursor-pointer'
                    }
                    ${isOpen ? 'border-indigo-400 dark:border-indigo-500 shadow-md ring-4 ring-indigo-500/10' : ''}
                `}
            >
                <span className={`flex items-center gap-2 min-w-0 ${selectedOption ? '' : 'text-slate-400 dark:text-slate-500'}`}>
                    {selectedOption?.icon && <selectedOption.icon className="w-4 h-4 text-slate-400 shrink-0" />}
                    <span className="truncate">{selectedOption?.label || placeholder}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                    {selectedOption?.badge !== undefined && selectedOption?.badge !== null && (
                        <span className={`text-xs ${selectedOption.badgeColor || 'text-slate-500 dark:text-slate-400'}`}>
                            {selectedOption.badge === -1 ? '—' : selectedOption.badge}
                        </span>
                    )}
                    <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${
                            isOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'
                        }`}
                    />
                </span>
            </button>

            {/* Dropdown Menu */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-50 w-full mt-2
                            bg-white/95 dark:bg-slate-900/95
                            backdrop-blur-xl
                            border border-slate-200 dark:border-slate-700
                            rounded-xl
                            shadow-2xl
                            overflow-hidden"
                    >
                        {/* Search input */}
                        {searchable && (
                            <div className="px-3 pt-3 pb-2">
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                    <input
                                        ref={searchRef}
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => {
                                            setSearchQuery(e.target.value)
                                            setFocusedIndex(0)
                                        }}
                                        placeholder="Filtrar..."
                                        className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                                    />
                                </div>
                            </div>
                        )}

                        <div ref={listRef} role="listbox" aria-label={label} aria-busy={loading} className="max-h-60 overflow-y-auto py-1 custom-scrollbar">
                            {/* Loading skeleton */}
                            {loading && (
                                Array.from({ length: skeletonCount }).map((_, i) => (
                                    <div key={`skeleton-${i}`} className="px-3 py-2.5 flex items-center justify-between">
                                        <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                                        <div className="h-3 w-10 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                                    </div>
                                ))
                            )}

                            {/* Error state */}
                            {!loading && errorState}

                            {/* Empty state */}
                            {!loading && !errorState && filteredOptions.length === 0 && (
                                emptyState || (
                                    <div className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                                        {searchQuery ? 'No matches found' : 'No options available'}
                                    </div>
                                )
                            )}

                            {/* Sections mode */}
                            {!loading && !errorState && sections && indexedSections.map((section, sIdx) => {
                                const sectionOptions = section.options || []
                                if (sectionOptions.length === 0) return null
                                return (
                                    <div key={section.title || sIdx} role="group" aria-label={section.title || undefined}>
                                        {section.title && (
                                            <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                                {section.title}
                                            </div>
                                        )}
                                        {sectionOptions.map((opt) => renderOption(opt, opt._globalIndex))}
                                    </div>
                                )
                            })}

                            {/* Flat options mode */}
                            {!loading && !errorState && !sections && filteredOptions.map((option, index) => (
                                renderOption(option, index)
                            ))}

                            {/* Extra option at the bottom */}
                            {!loading && extraOption}
                        </div>

                        {/* Footer */}
                        {footer && (
                            <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                                {footer}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
