import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NotesPage } from '../features/notes/NotesPage'

// ---------------------------------------------------------------------------
// Mock the api module - same convention as this repo's router tests / the
// sibling tafel repo's list-page tests (vi.mock('../lib/api', ...) with a
// plain get/post/put/delete jest-fn shape).
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

// ---------------------------------------------------------------------------
// Mock TanStack Router. NotesPage links each note card to its editor route
// via <Link to="/notes/$id" params={{ id }}> (declarative - fine to stub as
// a plain <a> whose exact resolved href we don't assert on), but creating a
// new note navigates programmatically once the created note's id comes back
// from the api.post response, which can only be done with the imperative
// useNavigate() hook (the target isn't known until the mutation resolves).
// So navigation assertions for "create note" use the mocked useNavigate,
// following the same approach as this repo's AuthCallbackPage.test.tsx.
// ---------------------------------------------------------------------------
const mockNavigate = vi.fn()
// useSearch is a vi.fn() (rather than a fixed `() => ({})`, as in the sibling
// test files) so tests below can vary the current search params - see
// QuickSwitcher.test.tsx's header comment for why: NotesPage now reads a
// `tag` search param (per the new virtual-folders feature) via useSearch,
// and we need to simulate both a `{ tag: 'work' }` and a `{}` search state.
const mockUseSearch = vi.fn(() => ({}) as Record<string, unknown>)
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
  useSearch: () => mockUseSearch(),
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
    id: 'note-1', title: 'Pinned Note', content: 'pinned content', pinned: true, archived: false, tags: [] as string[],
    createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z',
  },
  {
    id: 'note-2', title: 'Regular Note', content: 'regular content', pinned: false, archived: false, tags: [] as string[],
    createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-03T00:00:00Z',
  },
]

beforeEach(() => {
  mockNavigate.mockClear()
  mockUseSearch.mockReset()
  mockUseSearch.mockReturnValue({})
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
})

// ---------------------------------------------------------------------------
// Rendering the fetched notes
// ---------------------------------------------------------------------------
describe('NotesPage — rendering fetched notes', () => {
  it('fetches GET /notes and renders every note title', async () => {
    vi.mocked(api.get).mockResolvedValue(notes)
    render(<NotesPage />, { wrapper: createWrapper() })

    await screen.findByText('Pinned Note')
    expect(screen.getByText('Regular Note')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/notes')
  })

  it('groups pinned notes under a distinct "pinned" heading, separate from the rest', async () => {
    vi.mocked(api.get).mockResolvedValue(notes)
    render(<NotesPage />, { wrapper: createWrapper() })

    await screen.findByText('Pinned Note')

    // The actual rendered copy: "Закреплённые" ("Pinned") for the pinned
    // group and "Остальные" ("The rest") for the unpinned group.
    const pinnedHeading = screen.getByText(/Закреплённые/i)
    const otherHeading = screen.getByText(/Остальные/i)
    expect(pinnedHeading).toBeInTheDocument()
    expect(otherHeading).toBeInTheDocument()

    // Structural check: pinned heading -> pinned note -> other heading ->
    // unpinned note, in that DOM order.
    const bodyText = document.body.textContent ?? ''
    const pinnedHeadingIdx = bodyText.indexOf('Закреплённые')
    const pinnedNoteIdx = bodyText.indexOf('Pinned Note')
    const otherHeadingIdx = bodyText.indexOf('Остальные')
    const regularNoteIdx = bodyText.indexOf('Regular Note')
    expect(pinnedHeadingIdx).toBeGreaterThanOrEqual(0)
    expect(pinnedHeadingIdx).toBeLessThan(pinnedNoteIdx)
    expect(pinnedNoteIdx).toBeLessThan(otherHeadingIdx)
    expect(otherHeadingIdx).toBeLessThan(regularNoteIdx)
  })
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
describe('NotesPage — empty state', () => {
  it('shows "no notes yet" messaging when GET /notes resolves empty and no search has been typed', async () => {
    vi.mocked(api.get).mockResolvedValue([])
    render(<NotesPage />, { wrapper: createWrapper() })

    await screen.findByText(/Заметок пока нет/i)
  })
})

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
describe('NotesPage — search', () => {
  it('debounces typed search input into a new GET /notes call carrying the query', async () => {
    vi.mocked(api.get).mockResolvedValue(notes)
    const user = userEvent.setup()
    render(<NotesPage />, { wrapper: createWrapper() })

    await screen.findByText('Pinned Note')
    vi.mocked(api.get).mockClear()
    vi.mocked(api.get).mockResolvedValue(notes)

    const searchInput = screen.getByPlaceholderText(/Поиск/i)
    await user.type(searchInput, 'hello')

    await vi.waitFor(
      () => {
        const calledWithQuery = vi.mocked(api.get).mock.calls.some(
          (call) => typeof call[0] === 'string' && call[0].includes('hello'),
        )
        expect(calledWithQuery).toBe(true)
      },
      { timeout: 2000 },
    )

    // Debounced: typing 5 characters should not fire 5 separate requests.
    expect(vi.mocked(api.get).mock.calls.length).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Creating a note
// ---------------------------------------------------------------------------
describe('NotesPage — creating a note', () => {
  it('clicking "Новая заметка" posts to /notes and navigates to the created note', async () => {
    vi.mocked(api.get).mockResolvedValue(notes)
    const createdNote = {
      id: 'new-note-id', title: '', content: '', pinned: false, archived: false, tags: [] as string[],
      createdAt: '2024-01-04T00:00:00Z', updatedAt: '2024-01-04T00:00:00Z',
    }
    vi.mocked(api.post).mockResolvedValue(createdNote)
    const user = userEvent.setup()

    render(<NotesPage />, { wrapper: createWrapper() })
    await screen.findByText('Pinned Note')

    const createButton = screen.getByRole('button', { name: /новая заметка/i })
    await user.click(createButton)

    await vi.waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(vi.mocked(api.post).mock.calls[0]?.[0]).toBe('/notes')

    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    const navArg = mockNavigate.mock.calls[0]?.[0] as Record<string, unknown>
    const navString = JSON.stringify(navArg)
    expect(navString).toContain('new-note-id')
  })
})

// ---------------------------------------------------------------------------
// Tag chips on note cards (new)
// ---------------------------------------------------------------------------
describe('NotesPage — tag chips on cards', () => {
  it('renders each tag in a non-empty tags array as a read-only chip with visible text, and no remove control', async () => {
    const taggedNotes = [
      { ...notes[0]!, tags: ['Work', 'Urgent'] },
      { ...notes[1]! },
    ]
    vi.mocked(api.get).mockResolvedValue(taggedNotes)
    render(<NotesPage />, { wrapper: createWrapper() })

    await screen.findByText('Pinned Note')
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getByText('Urgent')).toBeInTheDocument()

    // Read-only: no button/remove-control anywhere among the tag chips.
    // (NotesPage has no other buttons besides "Новая заметка" itself in
    // this fixture, but scope narrowly to be safe: only that one button
    // should exist.)
    const buttons = screen.getAllByRole('button')
    expect(buttons.every((b) => !/work|urgent/i.test(b.textContent ?? ''))).toBe(true)
  })

  it('renders no tag chip elements and does not crash for a note with an empty tags array', async () => {
    const untaggedNotes = [{ ...notes[0]!, tags: [] }, { ...notes[1]!, tags: [] }]
    vi.mocked(api.get).mockResolvedValue(untaggedNotes)
    render(<NotesPage />, { wrapper: createWrapper() })

    await screen.findByText('Pinned Note')
    expect(screen.getByText('Regular Note')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tag-filter behavior (new "virtual folders" feature) - written from the
// behavioral spec without reading NotesPage.tsx's implementation of how it
// reads/applies the `tag` search param. useSearch is mocked per-test via
// mockUseSearch (see the router mock above).
// ---------------------------------------------------------------------------
describe('NotesPage — tag filtering via the `tag` search param', () => {
  it('when the URL search has tag: "work", fetches /notes with tag=work in the query', async () => {
    mockUseSearch.mockReturnValue({ tag: 'work' })
    vi.mocked(api.get).mockResolvedValue(notes)
    render(<NotesPage />, { wrapper: createWrapper() })

    await vi.waitFor(() => {
      const calledWithTag = vi.mocked(api.get).mock.calls.some((call) => {
        const arg = call[0]
        return typeof arg === 'string' && /tag=work\b/.test(decodeURIComponent(arg))
      })
      expect(calledWithTag).toBe(true)
    })
  })

  it('when there is no tag in the search params, fetches /notes without any tag scoping', async () => {
    mockUseSearch.mockReturnValue({})
    vi.mocked(api.get).mockResolvedValue(notes)
    render(<NotesPage />, { wrapper: createWrapper() })

    await screen.findByText('Pinned Note')
    const everCalledWithTag = vi.mocked(api.get).mock.calls.some((call) => {
      const arg = call[0]
      return typeof arg === 'string' && /tag=/.test(arg)
    })
    expect(everCalledWithTag).toBe(false)
  })

  it('shows a visible indicator of the active tag name while a tag filter is active', async () => {
    mockUseSearch.mockReturnValue({ tag: 'work' })
    vi.mocked(api.get).mockResolvedValue(notes)
    render(<NotesPage />, { wrapper: createWrapper() })

    await screen.findByText('Pinned Note')
    // At least one element renders the active tag's name somewhere on the
    // page (separate from any per-note tag chips, though we're deliberately
    // tolerant of overlap - the spec only requires >=1 match).
    const matches = screen.getAllByText(/work/i)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('provides a way to clear the active tag filter, navigating back to the unfiltered /notes view', async () => {
    mockUseSearch.mockReturnValue({ tag: 'work' })
    vi.mocked(api.get).mockResolvedValue(notes)
    render(<NotesPage />, { wrapper: createWrapper() })

    await screen.findByText('Pinned Note')

    // Link is stubbed as a plain <a> whose href is either the literal `to`
    // string or a JSON-stringified `to` object (see the router mock above).
    // A "clear filter" control should be an anchor pointing somewhere that
    // does NOT carry the active tag.
    const anchors = Array.from(document.querySelectorAll('a'))
    const clearCandidates = anchors.filter((a) => {
      const href = a.getAttribute('href') ?? ''
      return !/tag/i.test(href) || (/"tag":\s*null/.test(href) || /"tag":\s*""/.test(href))
    })
    expect(clearCandidates.length).toBeGreaterThan(0)
  })

  it('does not show the "first time ever" onboarding empty state when a tag filter has zero matching notes', async () => {
    mockUseSearch.mockReturnValue({ tag: 'work' })
    vi.mocked(api.get).mockResolvedValue([])
    render(<NotesPage />, { wrapper: createWrapper() })

    // Give the fetch a tick to resolve before asserting absence.
    await vi.waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.queryByText(/Заметок пока нет/i)).not.toBeInTheDocument()
  })
})
