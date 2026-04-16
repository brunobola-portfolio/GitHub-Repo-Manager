// Shared motion tokens for the Migration Wizard.
// Centralizing these eliminates the mix of easeInOut/easeOut/ad-hoc springs
// across step components.

export const WIZARD_EASE = [0.16, 1, 0.3, 1]

export const WIZARD_SPRING = { type: 'spring', stiffness: 380, damping: 30 }

export const PANEL_SPRING = { type: 'spring', stiffness: 380, damping: 32 }

export const STAGGER_FAST = 0.03    // rows in large lists (>50 items)
export const STAGGER_NORMAL = 0.05  // cards in Configure / small lists
