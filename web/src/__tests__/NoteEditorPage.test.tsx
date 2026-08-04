import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NoteEditorPage } from '../features/notes/NoteEditorPage'

// ---------------------------------------------------------------------------
// Mock the api module - same convention as this repo's router tests / the
// sibling tafel repo's editor/form tests.
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
// Mock TanStack Router. NoteEditorPage reads the note id via useParams and
// navigates back to the list imperatively after archiving (the destination
// is a fixed route, not data-dependent, but it's still driven by a
// mutation's onSuccess callback rather than a declarative Link the user
// clicks) - so useNavigate is mocked the same way as AuthCallbackPage.test.tsx
// and NotesPage.test.tsx in this same suite. The breadcrumb "Заметки" link
// back to /notes is declarative and stubbed as a plain <a>.
// ---------------------------------------------------------------------------
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ id: 'note-1' }),
  useSearch: () => ({}),
  useLocation: () => ({ pathname: '/notes/note-1' }),
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

const note = {
  id: 'note-1', title: 'My Note Title', content: 'Some **markdown** content', pinned: false, archived: false,
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z',
}

// Echoes back the merged note so that partial-update responses (e.g. just
// { pinned: true }) don't clobber fields the mock wasn't told about - a
// naive `mockResolvedValue({ ...note, pinned: true })` shared across calls
// would make the very first (title/content) autosave incorrectly look like
// it also pinned the note, since NoteEditorPage applies the PUT response
// back onto its local state.
function mockPutEchoingMergedNote() {
  vi.mocked(api.put).mockImplementation((_path: string, body: unknown) =>
    Promise.resolve({ ...note, ...(body as Record<string, unknown>) }),
  )
}

// ---------------------------------------------------------------------------
// api.get now backs three different reads from this one page: the single
// note by id, the full notes list (used to resolve [[Title]] wiki-links),
// and this note's backlinks. A single blanket mockResolvedValue can no
// longer serve all three - components expecting an array (the notes list,
// the backlinks list) would otherwise be handed the lone note object. This
// helper branches by the requested path/URL, defaulting the two list-shaped
// endpoints to [] unless a test opts into richer data for them.
// ---------------------------------------------------------------------------
function mockApiGet(overrides: { note?: unknown; notes?: unknown[]; backlinks?: unknown[] } = {}) {
  const singleNote = overrides.note ?? note
  const notesList = overrides.notes ?? []
  const backlinksList = overrides.backlinks ?? []
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/notes/note-1') return Promise.resolve(singleNote)
    if (path === '/notes') return Promise.resolve(notesList)
    if (path === '/notes/note-1/backlinks') return Promise.resolve(backlinksList)
    return Promise.resolve([])
  })
}

beforeEach(() => {
  mockNavigate.mockClear()
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
})

// ---------------------------------------------------------------------------
// Rendering the fetched note
// ---------------------------------------------------------------------------
describe('NoteEditorPage — rendering the fetched note', () => {
  it('fetches GET /notes/:id and shows the title in an editable field and the content in the editor', async () => {
    mockApiGet()
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    const titleInput = await screen.findByDisplayValue('My Note Title')
    expect(titleInput.tagName).toBe('INPUT')
    expect(api.get).toHaveBeenCalledWith('/notes/note-1')

    const contentField = screen.getByPlaceholderText(/пишите здесь/i) as HTMLTextAreaElement
    expect(contentField.value).toBe('Some **markdown** content')
  })
})

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------
describe('NoteEditorPage — autosave', () => {
  it('does not call api.put merely from rendering, with no user edits', async () => {
    mockApiGet()
    mockPutEchoingMergedNote()
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    await screen.findByDisplayValue('My Note Title')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(api.put).not.toHaveBeenCalled()
  })

  it('saves edited content after the debounce settles, reflecting the new value', async () => {
    mockApiGet()
    mockPutEchoingMergedNote()
    const user = userEvent.setup()
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    const contentField = await screen.findByPlaceholderText(/пишите здесь/i)
    await user.type(contentField, ' more')

    await vi.waitFor(
      () => {
        expect(api.put).toHaveBeenCalled()
      },
      { timeout: 2000 },
    )
    const [path, body] = vi.mocked(api.put).mock.calls[0]!
    expect(path).toBe('/notes/note-1')
    expect((body as Record<string, unknown>).content).toBe('Some **markdown** content more')
  })

  it('coalesces several rapid edits into a small number of saves, not one per keystroke', async () => {
    mockApiGet()
    mockPutEchoingMergedNote()
    const user = userEvent.setup()
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    const titleInput = await screen.findByDisplayValue('My Note Title')
    // Several rapid keystrokes within the debounce window.
    await user.type(titleInput, ' updated')

    await vi.waitFor(
      () => {
        expect(api.put).toHaveBeenCalled()
      },
      { timeout: 2000 },
    )
    // Give any further (incorrect) per-keystroke saves a chance to land.
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(vi.mocked(api.put).mock.calls.length).toBeLessThanOrEqual(2)
    const lastCall = vi.mocked(api.put).mock.calls.at(-1)!
    expect((lastCall[1] as Record<string, unknown>).title).toBe('My Note Title updated')
  })
})

// ---------------------------------------------------------------------------
// Pin toggle
// ---------------------------------------------------------------------------
describe('NoteEditorPage — pin toggle', () => {
  it('clicking the pin control calls api.put with pinned: true for an unpinned note', async () => {
    mockApiGet()
    mockPutEchoingMergedNote()
    const user = userEvent.setup()
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    await screen.findByDisplayValue('My Note Title')
    const pinButton = screen.getByLabelText(/закреп/i)
    await user.click(pinButton)

    await vi.waitFor(() => expect(api.put).toHaveBeenCalled())
    const [path, body] = vi.mocked(api.put).mock.calls[0]!
    expect(path).toBe('/notes/note-1')
    expect((body as Record<string, unknown>).pinned).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------
describe('NoteEditorPage — archive', () => {
  it('clicking archive calls api.delete(/notes/:id) and navigates back to the notes list', async () => {
    mockApiGet()
    vi.mocked(api.delete).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    await screen.findByDisplayValue('My Note Title')
    const archiveButton = screen.getByLabelText(/архивир/i)
    await user.click(archiveButton)

    await vi.waitFor(() => expect(api.delete).toHaveBeenCalled())
    expect(vi.mocked(api.delete).mock.calls[0]?.[0]).toBe('/notes/note-1')

    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    const navArg = mockNavigate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(JSON.stringify(navArg)).toContain('/notes')
  })
})

// ---------------------------------------------------------------------------
// Data fetched on mount for the wiki-links / backlinks feature
// ---------------------------------------------------------------------------
describe('NoteEditorPage — related data fetched on mount', () => {
  it('fetches the full notes list and this note\'s backlinks in addition to the note itself', async () => {
    mockApiGet()
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    await screen.findByDisplayValue('My Note Title')
    await vi.waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/notes/note-1')
      expect(api.get).toHaveBeenCalledWith('/notes')
      expect(api.get).toHaveBeenCalledWith('/notes/note-1/backlinks')
    })
  })
})

// ---------------------------------------------------------------------------
// Wiki-link rendering in the preview
// ---------------------------------------------------------------------------
describe('NoteEditorPage — wiki-link rendering', () => {
  const linkedNote = {
    id: 'note-2', title: 'Other Note', content: '', pinned: false, archived: false,
    createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
  }

  // The default view mode renders the raw markdown source (a <textarea>,
  // which legitimately still contains the literal "[[Title]]" text) side by
  // side with the rendered preview - so text-content assertions about
  // brackets being present/absent must be scoped to the preview pane only,
  // not the whole document, or they'd spuriously match the source textarea.
  function getPreview(): HTMLElement {
    const preview = document.querySelector('.markdown-preview')
    if (!preview) throw new Error('markdown preview container not found')
    return preview as HTMLElement
  }

  it('renders [[Title]] as a clickable link (no literal brackets) when Title matches a note from the full list', async () => {
    const noteWithLink = { ...note, content: 'See [[Other Note]] for details' }
    mockApiGet({ note: noteWithLink, notes: [noteWithLink, linkedNote] })
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    await screen.findByDisplayValue('My Note Title')
    const preview = within(await vi.waitFor(() => getPreview()))
    const link = await preview.findByRole('link', { name: 'Other Note' })
    expect(link.textContent).toBe('Other Note')
    expect(link.textContent).not.toMatch(/\[\[|\]\]/)
    expect(preview.queryByText(/\[\[Other Note\]\]/)).not.toBeInTheDocument()
  })

  it('matches case-insensitively and trims surrounding whitespace inside the brackets', async () => {
    const noteWithLink = { ...note, content: 'See [[ other NOTE ]] for details' }
    mockApiGet({ note: noteWithLink, notes: [noteWithLink, linkedNote] })
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    const link = await screen.findByRole('link', { name: /other note/i })
    expect(link.textContent?.trim().toLowerCase()).toBe('other note')
  })

  it('clicking a matched wiki-link triggers client-side navigation to that note\'s id, not a real browser navigation', async () => {
    const noteWithLink = { ...note, content: 'See [[Other Note]] for details' }
    mockApiGet({ note: noteWithLink, notes: [noteWithLink, linkedNote] })
    const user = userEvent.setup()
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    const link = await screen.findByRole('link', { name: 'Other Note' })
    await user.click(link)

    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    const navArg = mockNavigate.mock.calls.at(-1)?.[0]
    expect(JSON.stringify(navArg)).toContain('note-2')
  })

  it('renders [[Title]] as literal bracketed text when Title does not match any note in the list', async () => {
    const noteWithLink = { ...note, content: 'See [[Nonexistent Title]] here' }
    mockApiGet({ note: noteWithLink, notes: [noteWithLink, linkedNote] })
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    await screen.findByDisplayValue('My Note Title')
    const preview = within(await vi.waitFor(() => getPreview()))
    expect(preview.getByText(/\[\[Nonexistent Title\]\]/)).toBeInTheDocument()
    expect(preview.queryByRole('link', { name: /nonexistent title/i })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Backlinks panel
// ---------------------------------------------------------------------------
describe('NoteEditorPage — backlinks panel', () => {
  it('renders each backlink title as a link when the backlinks fetch resolves non-empty', async () => {
    mockApiGet({
      backlinks: [
        { id: 'note-9', title: 'Linker Note' },
        { id: 'note-10', title: 'Second Linker' },
      ],
    })
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    await screen.findByDisplayValue('My Note Title')
    expect(await screen.findByRole('link', { name: /linker note/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /second linker/i })).toBeInTheDocument()
  })

  // This app's declarative navigation links (this file's own breadcrumb
  // "Заметки" link, and NotesPage.test.tsx's note-card links) are mocked as
  // plain <a> elements whose exact resolved destination isn't asserted on -
  // only that they render as the correct link. Backlink entries follow that
  // same declarative-Link pattern (unlike the wiki-links in the preview,
  // which navigate imperatively via the mocked useNavigate and so *can*
  // assert their exact target - see the wiki-link click test above), so
  // per this file's existing convention we assert the link renders
  // correctly rather than asserting a specific navigation target.
  it('each backlink entry is a real link element (client-side navigable), not plain text', async () => {
    mockApiGet({ backlinks: [{ id: 'note-9', title: 'Linker Note' }] })
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    await screen.findByDisplayValue('My Note Title')
    const link = await screen.findByRole('link', { name: /linker note/i })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBeTruthy()
  })

  it('renders no backlinks section at all when the backlinks fetch resolves empty', async () => {
    mockApiGet({ backlinks: [] })
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    await screen.findByDisplayValue('My Note Title')
    await new Promise((resolve) => setTimeout(resolve, 100))

    // With no wiki-links in the note content and no backlinks, the only
    // link on the page should be the "Заметки" breadcrumb - no backlinks
    // section/placeholder should be present at all.
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveTextContent(/заметки/i)
  })
})
