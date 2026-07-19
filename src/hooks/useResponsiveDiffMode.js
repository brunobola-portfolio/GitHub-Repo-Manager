import { DiffModeEnum } from '@git-diff-view/react'
import { useMobileBreakpoint } from './useMobileBreakpoint'

/**
 * Diff view mode for the AI preview panels (README Studio, README enhance,
 * Diagram Generator, Agent Rules). Split renders two side-by-side columns —
 * below the md breakpoint (e.g. a 375px phone) that's two ~180px columns,
 * unreadable. Unified stacks old/new in one column instead, so mobile always
 * gets Unified; md+ keeps the two-pane Split view these panels default to.
 *
 * @returns {typeof DiffModeEnum[keyof typeof DiffModeEnum]}
 */
export function useResponsiveDiffMode() {
    const isMobile = useMobileBreakpoint()
    return isMobile ? DiffModeEnum.Unified : DiffModeEnum.Split
}
