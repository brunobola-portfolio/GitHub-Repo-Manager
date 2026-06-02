/**
 * Pure geometry helpers for the draggable / resizable WizardPanel (floating
 * desktop mode only). Kept framework-free so the clamping math is unit-tested
 * in isolation from React / framer-motion / jsdom layout quirks.
 */

// Below these the panel header + a usable slice of body stop being legible.
export const PANEL_MIN_W = 360
export const PANEL_MIN_H = 320

// Upper bounds mirror the Tailwind shell (`w-[min(92vw,…)]` /
// `max-h-[min(90vh,…)]`) so a manual resize can never push the panel past
// what the maximized/restored chrome already allows.
export const PANEL_MAX_W_RATIO = 0.96
export const PANEL_MAX_H_RATIO = 0.9

/**
 * Clamp a requested width/height to the legible/viewport-safe range.
 *
 * @param {number} width   requested width in px
 * @param {number} height  requested height in px
 * @param {number} vw      viewport width in px
 * @param {number} vh      viewport height in px
 * @returns {{ width: number, height: number }}
 */
export function clampPanelSize(width, height, vw, vh) {
  const maxW = Math.max(PANEL_MIN_W, Math.round(vw * PANEL_MAX_W_RATIO))
  const maxH = Math.max(PANEL_MIN_H, Math.round(vh * PANEL_MAX_H_RATIO))
  return {
    width: Math.round(Math.max(PANEL_MIN_W, Math.min(width, maxW))),
    height: Math.round(Math.max(PANEL_MIN_H, Math.min(height, maxH))),
  }
}
