import { describe, it, expect } from 'vitest'
import {
  clampPanelSize,
  PANEL_MIN_W,
  PANEL_MIN_H,
  PANEL_MAX_W_RATIO,
  PANEL_MAX_H_RATIO,
} from '../../../src/components/ui/wizardPanelGeometry'

describe('clampPanelSize', () => {
  it('clamps below-minimum dimensions up to the minimum', () => {
    const { width, height } = clampPanelSize(10, 10, 1920, 1080)
    expect(width).toBe(PANEL_MIN_W)
    expect(height).toBe(PANEL_MIN_H)
  })

  it('clamps above-maximum dimensions to the viewport ratio', () => {
    const { width, height } = clampPanelSize(99999, 99999, 1000, 800)
    expect(width).toBe(Math.round(1000 * PANEL_MAX_W_RATIO))
    expect(height).toBe(Math.round(800 * PANEL_MAX_H_RATIO))
  })

  it('passes mid-range dimensions through (rounded)', () => {
    const { width, height } = clampPanelSize(640.4, 500.6, 1920, 1080)
    expect(width).toBe(640)
    expect(height).toBe(501)
  })

  it('never returns less than the minimum even on a tiny viewport', () => {
    // 200px viewport * 0.96 = 192, below the 360 minimum — minimum must win so
    // the panel stays legible rather than collapsing.
    const { width, height } = clampPanelSize(300, 300, 200, 200)
    expect(width).toBe(PANEL_MIN_W)
    expect(height).toBe(PANEL_MIN_H)
  })
})
