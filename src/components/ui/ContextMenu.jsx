import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight } from 'lucide-react'

/**
 * ContextMenu - Reusable cascading context menu with keyboard navigation
 *
 * Props:
 * - items: Array of menu items (see item shape below)
 * - x, y: Position coordinates
 * - onClose: Close callback
 * - isSubmenu: (internal) Whether this is a submenu
 * - parentDirection: (internal) 'right' | 'left' for submenu positioning
 *
 * Item shape:
 * {
 *   type: 'item' | 'separator' | 'header',
 *   label: string,
 *   icon: LucideIcon,
 *   onClick: () => void,
 *   children: Item[],
 *   disabled: boolean,
 *   tooltip: string,
 *   danger: boolean,
 * }
 */
function ContextMenuInner({ items, x, y, onClose, isSubmenu = false, parentDirection = 'right' }) {
	const menuRef = useRef(null)
	const [position, setPosition] = useState({ top: y, left: x })
	const [hoveredIndex, setHoveredIndex] = useState(-1)
	const [activeSubmenu, setActiveSubmenu] = useState(-1)
	const [submenuDirection, setSubmenuDirection] = useState('right')
	const [focusedIndex, setFocusedIndex] = useState(-1)
	const hoverTimerRef = useRef(null)
	const itemRefs = useRef([])
	const [submenuPos, setSubmenuPos] = useState({ x: 0, y: 0 })

	// Get only actionable items (not separators/headers) for keyboard nav
	const actionableIndices = items
		.map((item, i) => (item.type !== 'separator' && item.type !== 'header') ? i : -1)
		.filter(i => i !== -1)

	// Viewport clamping
	useEffect(() => {
		if (!menuRef.current) return
		const rect = menuRef.current.getBoundingClientRect()
		const margin = 8
		let newTop = y
		let newLeft = x

		// Clamp vertically
		if (newTop + rect.height > window.innerHeight - margin) {
			newTop = Math.max(margin, window.innerHeight - rect.height - margin)
		}
		if (newTop < margin) newTop = margin

		// Clamp horizontally (flip submenu if needed)
		if (isSubmenu) {
			if (parentDirection === 'right' && newLeft + rect.width > window.innerWidth - margin) {
				// Flip to left
				newLeft = x - rect.width - (menuRef.current.parentElement?.getBoundingClientRect().width || 0)
				Promise.resolve().then(() => setSubmenuDirection('left'))
			} else if (parentDirection === 'left' && newLeft < margin) {
				newLeft = x + rect.width
				Promise.resolve().then(() => setSubmenuDirection('right'))
			} else {
				Promise.resolve().then(() => setSubmenuDirection(parentDirection))
			}
		} else {
			if (newLeft + rect.width > window.innerWidth - margin) {
				newLeft = Math.max(margin, window.innerWidth - rect.width - margin)
			}
		}

		if (newLeft < margin) newLeft = margin
		Promise.resolve().then(() => setPosition({ top: newTop, left: newLeft }))
	}, [x, y, isSubmenu, parentDirection])

	// Handle hover with delay for submenus
	const handleItemHover = useCallback((index) => {
		setHoveredIndex(index)
		clearTimeout(hoverTimerRef.current)

		const item = items[index]
		if (item?.children?.length > 0) {
			hoverTimerRef.current = setTimeout(() => {
				setActiveSubmenu(index)
			}, 100)
		} else {
			hoverTimerRef.current = setTimeout(() => {
				setActiveSubmenu(-1)
			}, 100)
		}
	}, [items])

	const handleItemLeave = useCallback(() => {
		setHoveredIndex(-1)
		// Don't immediately close submenu — let submenu hover keep it open
	}, [])

	// Click handler
	const handleItemClick = useCallback((item, index) => {
		if (item.disabled || item.type === 'separator' || item.type === 'header') return
		if (item.children?.length > 0) {
			setActiveSubmenu(activeSubmenu === index ? -1 : index)
			return
		}
		item.onClick?.()
		onClose()
	}, [activeSubmenu, onClose])

	// Keyboard navigation
	useEffect(() => {
		const handleKeyDown = (e) => {
			switch (e.key) {
				case 'Escape':
					e.preventDefault()
					e.stopPropagation()
					onClose()
					break
				case 'ArrowDown': {
					e.preventDefault()
					e.stopPropagation()
					const currentActionIdx = actionableIndices.indexOf(focusedIndex)
					const nextIdx = currentActionIdx < actionableIndices.length - 1
						? actionableIndices[currentActionIdx + 1]
						: actionableIndices[0]
					setFocusedIndex(nextIdx)
					setHoveredIndex(nextIdx)
					itemRefs.current[nextIdx]?.scrollIntoView?.({ block: 'nearest' })
					break
				}
				case 'ArrowUp': {
					e.preventDefault()
					e.stopPropagation()
					const currentActionIdx = actionableIndices.indexOf(focusedIndex)
					const prevIdx = currentActionIdx > 0
						? actionableIndices[currentActionIdx - 1]
						: actionableIndices[actionableIndices.length - 1]
					setFocusedIndex(prevIdx)
					setHoveredIndex(prevIdx)
					itemRefs.current[prevIdx]?.scrollIntoView?.({ block: 'nearest' })
					break
				}
				case 'ArrowRight': {
					e.preventDefault()
					e.stopPropagation()
					const item = items[focusedIndex]
					if (item?.children?.length > 0) {
						setActiveSubmenu(focusedIndex)
					}
					break
				}
				case 'ArrowLeft': {
					e.preventDefault()
					e.stopPropagation()
					if (isSubmenu) {
						onClose()
					} else if (activeSubmenu !== -1) {
						setActiveSubmenu(-1)
					}
					break
				}
				case 'Enter':
				case ' ': {
					e.preventDefault()
					e.stopPropagation()
					if (focusedIndex >= 0) {
						handleItemClick(items[focusedIndex], focusedIndex)
					}
					break
				}
				case 'Home': {
					e.preventDefault()
					e.stopPropagation()
					const first = actionableIndices[0]
					if (first !== undefined) {
						setFocusedIndex(first)
						setHoveredIndex(first)
					}
					break
				}
				case 'End': {
					e.preventDefault()
					e.stopPropagation()
					const last = actionableIndices[actionableIndices.length - 1]
					if (last !== undefined) {
						setFocusedIndex(last)
						setHoveredIndex(last)
					}
					break
				}
				default: {
					// Type-ahead search
					if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
						e.stopPropagation()
						const char = e.key.toLowerCase()
						const startIdx = focusedIndex >= 0 ? actionableIndices.indexOf(focusedIndex) + 1 : 0
						const searchOrder = [
							...actionableIndices.slice(startIdx),
							...actionableIndices.slice(0, startIdx)
						]
						const match = searchOrder.find(i =>
							items[i].label?.toLowerCase().startsWith(char)
						)
						if (match !== undefined) {
							setFocusedIndex(match)
							setHoveredIndex(match)
						}
					}
					break
				}
			}
		}

		if (!isSubmenu || activeSubmenu === -1) {
			window.addEventListener('keydown', handleKeyDown, true)
			return () => window.removeEventListener('keydown', handleKeyDown, true)
		}
	}, [focusedIndex, activeSubmenu, items, actionableIndices, isSubmenu, onClose, handleItemClick])

	// Focus menu on mount
	useEffect(() => {
		if (!isSubmenu) {
			menuRef.current?.focus()
		}
	}, [isSubmenu])

	// Cleanup hover timer
	useEffect(() => {
		return () => clearTimeout(hoverTimerRef.current)
	}, [])

	// Calculate submenu position
	const getSubmenuPosition = useCallback((index) => {
		const itemEl = itemRefs.current[index]
		if (!itemEl || !menuRef.current) return { x: 0, y: 0 }
		const itemRect = itemEl.getBoundingClientRect()
		const menuRect = menuRef.current.getBoundingClientRect()

		const subX = submenuDirection === 'right'
			? menuRect.right - 4
			: menuRect.left - menuRect.width + 4
		const subY = itemRect.top

		return { x: subX, y: subY }
	}, [submenuDirection])

	useLayoutEffect(() => {
		if (activeSubmenu >= 0) {
			Promise.resolve().then(() => setSubmenuPos(getSubmenuPosition(activeSubmenu)))
		}
	}, [activeSubmenu, getSubmenuPosition])

	return (
		<>
			{/* Backdrop for root menu only */}
			{!isSubmenu && (
				<div
					className="fixed inset-0 z-[99]"
					onClick={(e) => { e.stopPropagation(); onClose() }}
				/>
			)}

			<motion.div
				ref={menuRef}
				role="menu"
				tabIndex={-1}
				initial={{ opacity: 0, scale: 0.95 }}
				animate={{ opacity: 1, scale: 1 }}
				exit={{ opacity: 0, scale: 0.95 }}
				transition={{ duration: 0.12, ease: 'easeOut' }}
				className="fixed z-[100] min-w-[200px] max-w-[280px] max-h-[calc(100vh-16px)] overflow-y-auto py-1.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl shadow-2xl shadow-slate-900/20 dark:shadow-black/50 outline-none"
				style={{ top: position.top, left: position.left }}
				onClick={(e) => e.stopPropagation()}
			>
				{items.map((item, index) => {
					if (item.type === 'separator') {
						return (
							<div
								key={`sep-${index}`}
								className="my-1.5 mx-2 border-t border-slate-200/80 dark:border-slate-700/60"
								role="separator"
							/>
						)
					}

					if (item.type === 'header') {
						return (
							<div
								key={`hdr-${index}`}
								className="px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider select-none"
								role="presentation"
							>
								{item.label}
							</div>
						)
					}

					const isHovered = hoveredIndex === index || focusedIndex === index
					const hasChildren = item.children?.length > 0
					const Icon = item.icon

					return (
						<div
							key={item.label || index}
							ref={(el) => { itemRefs.current[index] = el }}
							role="menuitem"
							aria-disabled={item.disabled ? 'true' : undefined}
							aria-haspopup={hasChildren ? 'true' : undefined}
							tabIndex={-1}
							title={item.disabled ? item.tooltip : undefined}
							className={`
								mx-1.5 px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 text-sm select-none transition-colors duration-75
								${item.disabled
									? 'opacity-40 cursor-not-allowed'
									: 'cursor-pointer'
								}
								${item.danger && !item.disabled
									? isHovered
										? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
										: 'text-red-600 dark:text-red-400'
									: isHovered && !item.disabled
										? 'bg-slate-100 dark:bg-slate-700/70 text-slate-900 dark:text-white'
										: 'text-slate-700 dark:text-slate-300'
								}
							`}
							onMouseEnter={() => {
								if (!item.disabled) handleItemHover(index)
							}}
							onMouseLeave={handleItemLeave}
							onClick={(e) => {
								e.stopPropagation()
								handleItemClick(item, index)
							}}
						>
							{Icon && (
								<Icon className={`w-4 h-4 flex-shrink-0 ${
									item.danger
										? ''
										: isHovered && !item.disabled
											? 'text-slate-600 dark:text-slate-300'
											: 'text-slate-400 dark:text-slate-500'
								}`} />
							)}
							<span className="flex-1 truncate">{item.label}</span>
							{hasChildren && (
								<ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-slate-400 dark:text-slate-500" />
							)}
						</div>
					)
				})}

				{/* Render active submenu */}
				<AnimatePresence>
					{activeSubmenu >= 0 && items[activeSubmenu]?.children && (
						<ContextMenuInner
							key={`sub-${activeSubmenu}`}
							items={items[activeSubmenu].children}
							x={submenuPos.x}
							y={submenuPos.y}
							onClose={() => setActiveSubmenu(-1)}
							isSubmenu
							parentDirection={submenuDirection}
						/>
					)}
				</AnimatePresence>
			</motion.div>
		</>
	)
}

const ContextMenu = memo(function ContextMenu(props) {
	return (
		<AnimatePresence>
			<ContextMenuInner {...props} />
		</AnimatePresence>
	)
})

export default ContextMenu
