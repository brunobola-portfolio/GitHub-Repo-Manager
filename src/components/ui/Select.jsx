import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

/**
 * Custom Select Component with beautiful styling
 * @param {Object} props
 * @param {Array} props.options - Array of {value, label} objects
 * @param {string} props.value - Selected value
 * @param {Function} props.onChange - Change handler
 * @param {string} props.placeholder - Placeholder text
 * @param {string} props.className - Additional classes
 * @param {boolean} props.disabled - Disabled state
 * @param {string} props.size - Size variant: 'sm', 'md', 'lg'
 */
export function Select({
    options = [],
    value,
    onChange,
    placeholder = 'Select...',
    className = '',
    disabled = false,
    size = 'md'
}) {
    const [isOpen, setIsOpen] = useState(false)
    const selectRef = useRef(null)

    const selectedOption = options.find(opt => opt.value === value)

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (selectRef.current && !selectRef.current.contains(event.target)) {
                setIsOpen(false)
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    // Size variants
    const sizeClasses = {
        sm: 'px-2.5 py-1.5 text-xs',
        md: 'px-3 py-2 text-sm',
        lg: 'px-4 py-2.5 text-base'
    }

    const handleSelect = (optionValue) => {
        onChange?.(optionValue)
        setIsOpen(false)
    }

    return (
        <div ref={selectRef} className={`relative ${className}`}>
            {/* Select Trigger */}
            <button
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setIsOpen(!isOpen)}
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
                    ${disabled
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-white dark:hover:bg-slate-800 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:shadow-md cursor-pointer'
                    }
                    ${isOpen ? 'border-indigo-400 dark:border-indigo-500 shadow-md ring-4 ring-indigo-500/10' : ''}
                `}
            >
                <span className={selectedOption ? '' : 'text-slate-400 dark:text-slate-500'}>
                    {selectedOption?.label || placeholder}
                </span>
                <ChevronDown
                    className={`w-4 h-4 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'
                    }`}
                />
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
                        <div className="max-h-60 overflow-y-auto py-1 custom-scrollbar">
                            {options.map((option) => {
                                const isSelected = option.value === value
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => handleSelect(option.value)}
                                        className={`
                                            w-full flex items-center justify-between gap-2
                                            px-3 py-2.5
                                            text-left text-sm font-medium
                                            transition-all duration-150
                                            ${isSelected
                                                ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                            }
                                        `}
                                    >
                                        <span>{option.label}</span>
                                        {isSelected && (
                                            <Check className="w-4 h-4 text-indigo-500" />
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
