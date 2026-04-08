import { describe, it, expect } from 'vitest'
import { calculateMenuPosition } from '@/lib/menuPositioning'

const viewport = { width: 1280, height: 800 }
const margin = 8

describe('calculateMenuPosition', () => {
  describe('main menu (not submenu)', () => {
    it('opens down+right when there is room', () => {
      const pos = calculateMenuPosition({
        clickX: 100, clickY: 100,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      expect(pos).toEqual({ top: 100, left: 100, submenuDirection: 'right' })
    })

    it('flips up when not enough room below', () => {
      const pos = calculateMenuPosition({
        clickX: 100, clickY: 750,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      // Not enough space below (800 - 750 = 50 < 160), space above 750 >= 160 → flip up
      expect(pos.top).toBe(750 - 160)
      expect(pos.left).toBe(100)
    })

    it('flips left when not enough room right', () => {
      const pos = calculateMenuPosition({
        clickX: 1200, clickY: 100,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      // Not enough space right (1280 - 1200 = 80 < 200), space left 1200 >= 200 → flip left
      expect(pos.left).toBe(1200 - 200)
      expect(pos.top).toBe(100)
    })

    it('flips both axes when click is in bottom-right corner', () => {
      const pos = calculateMenuPosition({
        clickX: 1200, clickY: 750,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      expect(pos.left).toBe(1200 - 200)
      expect(pos.top).toBe(750 - 160)
    })

    it('clamps to viewport when menu is too tall to flip', () => {
      const pos = calculateMenuPosition({
        clickX: 100, clickY: 100,
        menuWidth: 200, menuHeight: 900, // larger than viewport height 800
        viewport, margin,
      })
      // Neither direction fits; clamp to margin and let it spill at the other edge
      expect(pos.top).toBe(margin)
    })

    it('clamps left to margin when click is near left edge', () => {
      const pos = calculateMenuPosition({
        clickX: 2, clickY: 100,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      expect(pos.left).toBe(margin)
    })

    it('clamps top to margin when click is near top edge', () => {
      const pos = calculateMenuPosition({
        clickX: 100, clickY: 2,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      expect(pos.top).toBe(margin)
    })
  })

  describe('submenu positioning', () => {
    it('opens to the right of the parent when there is room', () => {
      const pos = calculateMenuPosition({
        clickX: 300, clickY: 200,
        menuWidth: 180, menuHeight: 120,
        viewport, margin,
        isSubmenu: true,
        parentDirection: 'right',
      })
      expect(pos.left).toBe(300)
      expect(pos.submenuDirection).toBe('right')
    })

    it('flips to the left when parent-right side does not fit', () => {
      const pos = calculateMenuPosition({
        clickX: 1180, clickY: 200,
        menuWidth: 180, menuHeight: 120,
        viewport, margin,
        isSubmenu: true,
        parentDirection: 'right',
        parentWidth: 200, // parent menu is 200 wide
      })
      // 1180 + 180 = 1360 > 1280 - 8, must flip
      // flipped position = 1180 - 180 - 200 = 800
      expect(pos.left).toBe(800)
      expect(pos.submenuDirection).toBe('left')
    })

    it('submenu parent-left: opens to the left when there is room', () => {
      const pos = calculateMenuPosition({
        clickX: 500, clickY: 200,
        menuWidth: 180, menuHeight: 120,
        viewport, margin,
        isSubmenu: true,
        parentDirection: 'left',
      })
      expect(pos.left).toBe(500 - 180)
      expect(pos.submenuDirection).toBe('left')
    })

    it('submenu parent-left: flips right when left does not fit', () => {
      const pos = calculateMenuPosition({
        clickX: 50, clickY: 200,
        menuWidth: 180, menuHeight: 120,
        viewport, margin,
        isSubmenu: true,
        parentDirection: 'left',
        parentWidth: 200,
      })
      // 50 - 180 = -130 < margin, must flip right
      // flipped position = 50 + 200 = 250
      expect(pos.left).toBe(250)
      expect(pos.submenuDirection).toBe('right')
    })

    it('submenu clamps when flip-right overflows viewport', () => {
      // Small clickX but viewport is narrow — flip-right with parentWidth pushes menu off-screen
      const narrowViewport = { width: 300, height: 800 }
      const pos = calculateMenuPosition({
        clickX: 10, clickY: 200,
        menuWidth: 180, menuHeight: 120,
        viewport: narrowViewport,
        margin,
        isSubmenu: true,
        parentDirection: 'left',
        parentWidth: 200,
      })
      // Preferred left = 10 - 180 = -170 (doesn't fit) → flip right = 10 + 200 = 210
      // But 210 + 180 = 390 > 300 - 8 = 292, so final clamp pulls left to 300 - 180 - 8 = 112
      expect(pos.left).toBe(112)
    })
  })
})
