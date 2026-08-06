import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { QuickSwitcher } from '../components/QuickSwitcher'

// ---------------------------------------------------------------------------
// This test file was written from a black-box behavioral spec, without
// reading src/components/QuickSwitcher.tsx (or how it's wired into Layout /
// NotesPage) — per this project's rule that new-feature tests are authored
// blind to the implementation. Conventions (api mock shape, router mock
// shape, QueryClientProvider wrapper) are copied from NotesPage.test.tsx /
// NoteEditorPage.test.tsx, which are pre-existing and were fine to read.
// ---------------------------------------------------------------------------
vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import { api } from '../lib/api'

const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
  useSearch: () => ({}),
  useLocation: () => ({ pathname: '/notes' }),
  Link: (props: Record<string, unknown>) => {
    const { to, children } = props as { to: unknown; children?: React.ReactNode }
    return <a href={typeof to === 'string' ? to : JSON.stringify(to)}>{children as React.ReactNode}</a>
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const notes = [
  {
    id: 'n1', title: 'Grocery List', content: '', pinned: false, archived: false, tags: [] as string[],
    createdAt: '', updatedAt: '',
  },
  {
    id: 'n2', title: 'Trip Planning Notes', content: '', pinned: false, archived: false, tags: [] as string[],
    createdAt: '', updatedAt: '',
  },
  {
    id: 'n3', title: 'Budget Overview', content: '', pinned: false, archived: false, tags: [] as string[],
    createdAt: '', updatedAt: '',
  },
]

const PLACEHOLDER = /перейти/i
const NO_RESULTS = /ничего не найдено|нет результатов|no results/i

beforeEach(() => {
  mockNavigate.mockClear()
  vi.mocked(api.get).mockReset()
  vi.mocked(api.get).mockResolvedValue(notes)
})

function ctrlK() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
}

function cmdK() {
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
}

async function openSwitcher() {
  ctrlK()
  return screen.findByPlaceholderText(PLACEHOLDER)
}

/**
 * Determine the visual/DOM order the given notes were rendered in, by
 * finding each title's earliest index inside `root`'s text content. Used
 * so highlighted-result assertions don't have to assume the component
 * preserves the fixture array's order.
 */
function notesInRenderedOrder(root: HTMLElement, candidates: typeof notes) {
  const text = root.textContent ?? ''
  return [...candidates]
    .map((n) => ({ n, idx: text.indexOf(n.title) }))
    .filter((x) => x.idx !== -1)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.n)
}

/**
 * Finds the outermost rendered node of the (currently open) palette,
 * tolerant of the component either rendering in place inside RTL's
 * container, or via a React portal appended directly to document.body.
 */
function findPaletteRoot(container: HTMLElement): Element | null {
  if (container.firstElementChild) return container.firstElementChild
  const portalChild = Array.from(document.body.children).find((el) => el !== container)
  return portalChild ?? null
}

function navigateArgContains(id: string) {
  return mockNavigate.mock.calls.some((call) => JSON.stringify(call[0]).includes(id))
}

// ---------------------------------------------------------------------------
// 1. Closed by default
// ---------------------------------------------------------------------------
describe('QuickSwitcher — closed by default', () => {
  it('renders nothing visible until the shortcut is pressed', () => {
    render(<QuickSwitcher />, { wrapper: createWrapper() })
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Grocery List')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 2. Opens on Ctrl+K / Cmd+K
// ---------------------------------------------------------------------------
describe('QuickSwitcher — opening the shortcut', () => {
  it('opens on Ctrl+K, showing a search input', async () => {
    render(<QuickSwitcher />, { wrapper: createWrapper() })
    const input = await openSwitcher()
    expect(input).toBeVisible()
  })

  it('also opens on Cmd+K (metaKey, for Mac)', async () => {
    render(<QuickSwitcher />, { wrapper: createWrapper() })
    cmdK()
    const input = await screen.findByPlaceholderText(PLACEHOLDER)
    expect(input).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 3. Ctrl+K toggles closed when already open
// ---------------------------------------------------------------------------
describe('QuickSwitcher — toggling', () => {
  it('pressing Ctrl+K again while open closes it', async () => {
    render(<QuickSwitcher />, { wrapper: createWrapper() })
    await openSwitcher()

    ctrlK()

    await vi.waitFor(() => {
      expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Shows notes once open (empty query = everything)
// ---------------------------------------------------------------------------
describe('QuickSwitcher — listing notes', () => {
  it('shows all note titles once opened with an empty query', async () => {
    render(<QuickSwitcher />, { wrapper: createWrapper() })
    await openSwitcher()

    await screen.findByText('Grocery List')
    expect(screen.getByText('Trip Planning Notes')).toBeInTheDocument()
    expect(screen.getByText('Budget Overview')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/notes')
  })
})

// ---------------------------------------------------------------------------
// 5. Filtering
// ---------------------------------------------------------------------------
describe('QuickSwitcher — filtering by typed text', () => {
  it('narrows results to a case-insensitive substring match on title', async () => {
    const user = userEvent.setup()
    render(<QuickSwitcher />, { wrapper: createWrapper() })
    const input = await openSwitcher()
    await screen.findByText('Grocery List')

    await user.type(input, 'grocery')

    await vi.waitFor(() => {
      expect(screen.queryByText('Trip Planning Notes')).not.toBeInTheDocument()
    })
    expect(screen.queryByText('Budget Overview')).not.toBeInTheDocument()
    expect(screen.getByText('Grocery List')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 6. Enter navigates to the highlighted (default = first) result and closes
// ---------------------------------------------------------------------------
describe('QuickSwitcher — Enter navigates', () => {
  it('pressing Enter with no arrow-key movement navigates to the first-rendered result and closes the palette', async () => {
    const { container } = render(<QuickSwitcher />, { wrapper: createWrapper() })
    const input = await openSwitcher()
    await screen.findByText('Grocery List')
    await screen.findByText('Trip Planning Notes')
    await screen.findByText('Budget Overview')

    const ordered = notesInRenderedOrder(container, notes)
    expect(ordered.length).toBeGreaterThan(0)
    const expected = ordered[0]!

    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(navigateArgContains(expected.id)).toBe(true)

    await vi.waitFor(() => {
      expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// 7. Arrow keys move the highlighted result
// ---------------------------------------------------------------------------
describe('QuickSwitcher — arrow-key navigation', () => {
  it('ArrowDown moves the highlight so Enter acts on a different note than the default', async () => {
    const { container } = render(<QuickSwitcher />, { wrapper: createWrapper() })
    const input = await openSwitcher()
    await screen.findByText('Grocery List')
    await screen.findByText('Trip Planning Notes')
    await screen.findByText('Budget Overview')

    const ordered = notesInRenderedOrder(container, notes)
    expect(ordered.length).toBe(3)
    const third = ordered[2]!
    const first = ordered[0]!

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(navigateArgContains(third.id)).toBe(true)
    expect(navigateArgContains(first.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 8. Escape closes regardless of focus
// ---------------------------------------------------------------------------
describe('QuickSwitcher — Escape closes', () => {
  it('closes on a window-level Escape keydown, not scoped to the input having focus', async () => {
    render(<QuickSwitcher />, { wrapper: createWrapper() })
    const input = await openSwitcher()
    input.focus()

    fireEvent.keyDown(window, { key: 'Escape' })

    await vi.waitFor(() => {
      expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// 9. Clicking a result navigates directly
// ---------------------------------------------------------------------------
describe('QuickSwitcher — clicking a result', () => {
  it('clicking a result title navigates to that note', async () => {
    const user = userEvent.setup()
    render(<QuickSwitcher />, { wrapper: createWrapper() })
    await openSwitcher()
    await screen.findByText('Grocery List')

    await user.click(screen.getByText('Trip Planning Notes'))

    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(navigateArgContains('n2')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 10. Clicking the backdrop closes without navigating
// ---------------------------------------------------------------------------
describe('QuickSwitcher — clicking outside', () => {
  it('clicking the backdrop (outside the search box / results) closes without navigating', async () => {
    const { container } = render(<QuickSwitcher />, { wrapper: createWrapper() })
    await openSwitcher()
    await screen.findByText('Grocery List')

    const backdrop = findPaletteRoot(container)
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)

    await vi.waitFor(() => {
      expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument()
    })
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 11. No-results messaging
// ---------------------------------------------------------------------------
describe('QuickSwitcher — no results', () => {
  it('shows "no results" messaging when the typed text matches no title', async () => {
    const user = userEvent.setup()
    render(<QuickSwitcher />, { wrapper: createWrapper() })
    const input = await openSwitcher()
    await screen.findByText('Grocery List')

    await user.type(input, 'zzz_no_such_note_zzz')

    await screen.findByText(NO_RESULTS)
    expect(screen.queryByText('Grocery List')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 12. Re-opening resets the search field
// ---------------------------------------------------------------------------
describe('QuickSwitcher — reopening resets state', () => {
  it('clears a previously typed query when closed and reopened', async () => {
    const user = userEvent.setup()
    render(<QuickSwitcher />, { wrapper: createWrapper() })
    let input = await openSwitcher()
    await screen.findByText('Grocery List')

    await user.type(input, 'grocery')
    expect(input).toHaveValue('grocery')

    fireEvent.keyDown(window, { key: 'Escape' })
    await vi.waitFor(() => {
      expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument()
    })

    input = await openSwitcher()
    expect(input).toHaveValue('')
  })
})
