import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    vi.mocked(api.get).mockResolvedValue(note)
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
    vi.mocked(api.get).mockResolvedValue(note)
    mockPutEchoingMergedNote()
    render(<NoteEditorPage />, { wrapper: createWrapper() })

    await screen.findByDisplayValue('My Note Title')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(api.put).not.toHaveBeenCalled()
  })

  it('saves edited content after the debounce settles, reflecting the new value', async () => {
    vi.mocked(api.get).mockResolvedValue(note)
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
    vi.mocked(api.get).mockResolvedValue(note)
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
    vi.mocked(api.get).mockResolvedValue(note)
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
    vi.mocked(api.get).mockResolvedValue(note)
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
