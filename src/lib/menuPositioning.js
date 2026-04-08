/**
 * Pure flip-first menu positioner.
 *
 * Placement preference (in order):
 *   1. Open in the preferred direction if the menu fits there.
 *   2. Otherwise flip to the opposite side.
 *   3. Otherwise clamp to the viewport margin.
 *
 * @param {object} args
 * @param {number} args.clickX        - Click X in viewport coordinates
 * @param {number} args.clickY        - Click Y in viewport coordinates
 * @param {number} args.menuWidth     - Measured menu width in px
 * @param {number} args.menuHeight    - Measured menu height in px
 * @param {{width:number,height:number}} args.viewport
 * @param {number} [args.margin=8]    - Minimum gap from viewport edges
 * @param {boolean} [args.isSubmenu=false]
 * @param {'right'|'left'} [args.parentDirection='right'] - Preferred submenu side
 * @param {number} [args.parentWidth=0] - Parent menu width (submenu only) used when flipping left
 * @returns {{top:number, left:number, submenuDirection:'right'|'left'}}
 */
export function calculateMenuPosition({
	clickX,
	clickY,
	menuWidth,
	menuHeight,
	viewport,
	margin = 8,
	isSubmenu = false,
	parentDirection = 'right',
	parentWidth = 0,
}) {
	// --- Vertical placement ---
	const spaceBelow = viewport.height - clickY - margin
	const spaceAbove = clickY - margin
	let top
	if (menuHeight <= spaceBelow) {
		// Fits downward
		top = clickY
	} else if (menuHeight <= spaceAbove) {
		// Flip upward
		top = clickY - menuHeight
	} else {
		// Neither direction fits fully — clamp so the menu top is at margin
		top = margin
	}

	// --- Horizontal placement ---
	let left
	let submenuDirection = parentDirection

	if (isSubmenu) {
		// Submenu: prefer parentDirection; flip to the opposite side if it doesn't fit.
		if (parentDirection === 'right') {
			if (clickX + menuWidth <= viewport.width - margin) {
				left = clickX
				submenuDirection = 'right'
			} else {
				// Flip left: place submenu to the left of the parent menu
				left = clickX - menuWidth - parentWidth
				submenuDirection = 'left'
			}
		} else {
			// parentDirection === 'left'
			if (clickX - menuWidth >= margin) {
				left = clickX - menuWidth
				submenuDirection = 'left'
			} else {
				left = clickX + parentWidth
				submenuDirection = 'right'
			}
		}
	} else {
		// Main menu: prefer rightward from click.
		const spaceRight = viewport.width - clickX - margin
		const spaceLeft = clickX - margin
		if (menuWidth <= spaceRight) {
			left = clickX
		} else if (menuWidth <= spaceLeft) {
			left = clickX - menuWidth
		} else {
			left = margin
		}
	}

	// Final safety clamps in case caller gives out-of-range input.
	if (left < margin) left = margin
	if (top < margin) top = margin

	return { top, left, submenuDirection }
}
