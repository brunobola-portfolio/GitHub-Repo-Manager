/*
 * MobileOrgDrawer — the mobile-only left Drawer org switcher, extracted from
 * App.jsx into the OrgSidebar module. App renders it at the shell root so it
 * stays reachable on every view (the Header hamburger toggles it). This locks
 * its contract: gated on `user`, Drawer open/close wiring, and that selecting
 * an org both selects AND closes the drawer. Drawer + OrgPanel are stubbed to
 * prop-echoes so the test asserts wiring, not their internals.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MobileOrgDrawer } from '@/components/OrgSidebar'

vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ isOpen, onClose, children, side, width }) => (
    <div data-testid="drawer" data-open={String(isOpen)} data-side={side} data-width={width}>
      <button onClick={onClose}>drawer-close</button>
      {children}
    </div>
  ),
}))
vi.mock('@/components/OrgPanel', () => ({
  OrgPanel: ({ orgs, selectedOrg, onSelectOrg, user, stats, onCreateOrg }) => (
    <div
      data-testid="org-panel"
      data-selected={selectedOrg ?? ''}
      data-orgs={(orgs || []).length}
      data-user={user?.login}
      data-stats={stats ? 'y' : 'n'}
    >
      <button onClick={() => onSelectOrg('acme')}>select-acme</button>
      <button onClick={onCreateOrg}>create-org</button>
    </div>
  ),
}))

const USER = { login: 'octocat' }

function setup(overrides = {}) {
  const props = {
    user: USER,
    orgs: [{ login: 'a' }, { login: 'b' }],
    selectedOrg: 'a',
    stats: { total: 2 },
    isOpen: true,
    onClose: vi.fn(),
    onSelectOrg: vi.fn(),
    onCreateOrg: vi.fn(),
    ...overrides,
  }
  render(<MobileOrgDrawer {...props} />)
  return props
}

beforeEach(() => vi.clearAllMocks())

describe('MobileOrgDrawer', () => {
  it('renders nothing when there is no user', () => {
    setup({ user: null })
    expect(screen.queryByTestId('drawer')).toBeNull()
  })

  it('renders a left Drawer carrying the OrgPanel with the right data', () => {
    setup()
    const drawer = screen.getByTestId('drawer')
    expect(drawer).toHaveAttribute('data-open', 'true')
    expect(drawer).toHaveAttribute('data-side', 'left')
    expect(drawer).toHaveAttribute('data-width', '320')
    const panel = screen.getByTestId('org-panel')
    expect(panel).toHaveAttribute('data-selected', 'a')
    expect(panel).toHaveAttribute('data-orgs', '2')
    expect(panel).toHaveAttribute('data-user', 'octocat')
    expect(panel).toHaveAttribute('data-stats', 'y')
  })

  it('wires the Drawer close affordance', () => {
    const props = setup()
    fireEvent.click(screen.getByText('drawer-close'))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('selecting an org both selects it and closes the drawer', () => {
    const props = setup()
    fireEvent.click(screen.getByText('select-acme'))
    expect(props.onSelectOrg).toHaveBeenCalledWith('acme')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('wires the create-org affordance', () => {
    const props = setup()
    fireEvent.click(screen.getByText('create-org'))
    expect(props.onCreateOrg).toHaveBeenCalledTimes(1)
  })
})
