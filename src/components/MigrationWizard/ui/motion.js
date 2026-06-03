// Migration Wizard motion aliases — kept as named exports for the wizard step
// components, but now sourced from the shared `ui/motion` vocabulary so the
// wizard never drifts from the rest of the app (previously defined its own
// 380/30 spring alongside the app's 380/32 — unified here).
import { EASE, SPRING, STAGGER } from '../../ui/motion'

export const WIZARD_EASE = EASE.emphasized

export const WIZARD_SPRING = SPRING.panel

export const PANEL_SPRING = SPRING.panel

export const STAGGER_FAST = STAGGER.fast //   rows in large lists (>50 items)
export const STAGGER_NORMAL = STAGGER.normal // cards in Configure / small lists
