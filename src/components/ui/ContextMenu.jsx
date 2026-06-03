import { useState, useEffect, useLayoutEffect, useRef, useCallback, useId, memo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { calculateMenuPosition } from '@/lib/menuPositioning'

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
 *   description?: string,                                                         // optional second line in muted text
 *   icon: LucideIcon,
 *   onClick: () => void,
 *   children: Item[],
 *   disabled: boolean,
 *   tooltip: string,
 *   danger: boolean,
 *   intent?: 'navigation'|'copy'|'mutation'|'destructive'|'read-only',           // 'destructive' applies red styling
 * }
 */
function ContextMenuInner({ items, x, y, onClose, isSubmenu = false, parentDirection = 'right', parentMenuWidth = 0 }) {
	const menuRef = useRef(null)
	const [position, setPosition] = useState({ top: y, left: x })
	const [hoveredIndex, setHoveredIndex] = useState(-1)
	const [activeSubmenu, setActiveSubmenu] = useState(-1)
	const [submenuDirection, setSubmenuDirection] = useState('right')
	const [focusedIndex, setFocusedIndex] = useState(-1)
	const hoverTimerRef = useRef(null)
	const itemRefs = useRef([])
	// Stable per-menu base for description ids so each menuitem can link its
	// second line via aria-describedby without cross-instance collisions.
	const descBaseId = useId()
	const [submenuPos, setSubmenuPos] = useState({ x: 0, y: 0, parentMenuWidth: 0 })

	// Get only actionable items (not separators/headers) for keyboard nav
	const actionableIndices = items
		.map((item, i) => (item.type !== 'separator' && item.type !== 'header') ? i : -1)
		.filter(i => i !== -1)

	// Flip-first positioning: measure menu, then compute final placement.
	useLayoutEffect(() => {
		if (!menuRef.current) return
		const rect = menuRef.current.getBoundingClientRect()

		const result = calculateMenuPosition({
			clickX: x,
			clickY: y,
			menuWidth: rect.width,
			menuHeight: rect.height,
			viewport: { width: window.innerWidth, height: window.innerHeight },
			margin: 8,
			isSubmenu,
			parentDirection,
			parentWidth: parentMenuWidth,
		})

		Promise.resolve().then(() => {
			setPosition({ top: result.top, left: result.left })
			if (isSubmenu) setSubmenuDirection(result.submenuDirection)
		})
	}, [x, y, isSubmenu, parentDirection, parentMenuWidth])

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
		if (!itemEl || !menuRef.current) return { x: 0, y: 0, parentMenuWidth: 0 }
		const itemRect = itemEl.getBoundingClientRect()
		const menuRect = menuRef.current.getBoundingClientRect()

		const subX = submenuDirection === 'right'
			? menuRect.right - 4
			: menuRect.left - menuRect.width + 4
		const subY = itemRect.top

		return { x: subX, y: subY, parentMenuWidth: menuRect.width }
	}, [submenuDirection])

	useLayoutEffect(() => {
		if (activeSubmenu >= 0) {
			Promise.resolve().then(() => setSubmenuPos(getSubmenuPosition(activeSubmenu)))
		}
	}, [activeSubmenu, getSubmenuPosition])

	if (typeof document === 'undefined') return null

	const content = (
		<>
			{/* Backdrop for root menu only.
			    Must sit BELOW the menu (which uses --ds-z-ceiling), or it
			    intercepts pointer events on the menu's own items including
			    hover-to-open submenus. The previous z-[99] was a raw layer
			    above the ceiling token — silently broke right-click \xe2\x86\x92 AI \xe2\x86\x92
			    hover-to-open-submenu in every spec that exercised it. */}
			{!isSubmenu && (
				<div
					className="fixed inset-0 z-[var(--ds-z-modal)]"
					aria-hidden="true"
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
				className="fixed z-[var(--ds-z-ceiling)] min-w-[260px] max-w-[340px] overflow-visible p-1 rounded-xl border border-black/5 dark:border-white/10 bg-white/85 dark:bg-slate-900/90 backdrop-blur-md outline-none shadow-[0_20px_40px_-12px_rgba(0,0,0,0.25),0_2px_6px_-2px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_40px_-12px_rgba(0,0,0,0.55),0_2px_6px_-2px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)]"
				style={{ top: position.top, left: position.left }}
				onClick={(e) => e.stopPropagation()}
			>
				{items.map((item, index) => {
					if (item.type === 'separator') {
						return (
							<div
								key={`sep-${index}`}
								className="my-1 h-px bg-black/[0.06] dark:bg-white/[0.08]"
								role="separator"
							/>
						)
					}

					if (item.type === 'header') {
						return (
							<div
								key={`hdr-${index}`}
								className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-[0.08em] px-2.5 pt-1.5 pb-1 select-none"
								role="presentation"
							>
								{item.label}
							</div>
						)
					}

					const isHovered = hoveredIndex === index || focusedIndex === index
					// Keyboard-only focus gets an extra ring so arrow-key navigation is visible
					// even against a matching hover bg.
					const isKeyboardFocused = focusedIndex === index
					const hasChildren = item.children?.length > 0
					const Icon = item.icon

					return (
						// eslint-disable-next-line jsx-a11y/click-events-have-key-events -- menu-wide arrow/Enter/Esc handlers live on the parent <motion.div role="menu"> via handleKeyDown
						<div
							key={item.id || item.label || `item-${index}`}
							ref={(el) => { itemRefs.current[index] = el }}
							role="menuitem"
							aria-disabled={item.disabled ? 'true' : undefined}
							aria-haspopup={hasChildren ? 'true' : undefined}
							aria-expanded={hasChildren ? (activeSubmenu === index) : undefined}
							aria-describedby={item.description ? `${descBaseId}-desc-${index}` : undefined}
							tabIndex={-1}
							title={item.disabled ? item.tooltip : undefined}
							data-testid={item.id ? `menu-item-${item.id}` : undefined}
							className={`
								px-2.5 py-1.5 rounded-lg flex items-start gap-2.5 text-sm select-none transition-colors duration-75
								${item.disabled
									? 'opacity-40 cursor-not-allowed'
									: 'cursor-pointer'
								}
								${(item.danger || item.intent === 'destructive') && !item.disabled
									? isHovered
										? 'bg-red-500/10 dark:bg-red-500/15 text-red-600 dark:text-red-400'
										: 'text-red-600 dark:text-red-400'
									: isHovered && !item.disabled
										? 'bg-black/[0.06] dark:bg-white/[0.08] text-slate-900 dark:text-slate-100'
										: 'text-slate-700 dark:text-slate-300'
								}
							${isKeyboardFocused ? 'ring-2 ring-inset ring-indigo-500/70 dark:ring-indigo-400/70' : ''}
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
								<Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
									item.danger || item.intent === 'destructive'
										? ''
										: isHovered && !item.disabled
											? 'text-slate-600 dark:text-slate-300'
											: 'text-slate-400 dark:text-slate-500'
								}`} />
							)}
							<div className="flex-1 min-w-0">
								<div className="truncate leading-tight">{item.label}</div>
								{item.description && (
									<div
										data-testid="menu-item-description"
											id={`${descBaseId}-desc-${index}`}
										className={`ds-text-meta truncate leading-tight mt-0.5 ${
											(item.danger || item.intent === 'destructive')
												? 'text-red-500/80 dark:text-red-400/80'
												: 'text-slate-500 dark:text-slate-400'
										}`}
									>
										{item.description}
									</div>
								)}
							</div>
							{hasChildren && (
								<ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-slate-400 dark:text-slate-500 mt-0.5" />
							)}
						</div>
					)
				})}

			</motion.div>

			{/* Render active submenu as a sibling (not child) so framer-motion's
			    transform on the parent motion.div doesn't become a containing
			    block for the submenu's fixed positioning. */}
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
						parentMenuWidth={submenuPos.parentMenuWidth}
					/>
				)}
			</AnimatePresence>
		</>
	)

	return createPortal(content, document.body)
}

const ContextMenu = memo(function ContextMenu(props) {
	return (
		<AnimatePresence>
			<ContextMenuInner {...props} />
		</AnimatePresence>
	)
})

export default ContextMenu
