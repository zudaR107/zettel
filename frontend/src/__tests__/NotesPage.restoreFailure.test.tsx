import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotesPage } from '../features/notes/NotesPage'

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../hooks/useDatePrefs', () => ({
  useDatePrefs: () => ({ dateFormat: null, timezone: null }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('@zudar107/schloss-ui', () => ({
  Button: ({
    children,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props}>{children}</button>
  ),
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  SegmentedControl: ({
    options,
    onChange,
  }: {
    options: Array<{ value: string; label: string }>
    onChange: (value: string) => void
  }) => (
    <div>
      {options.map((option) => (
        <button key={option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  formatDate: (value: string) => value,
}))

import { api } from '../lib/api'

const activeNote = {
  id: 'active-note',
  title: 'Active Note',
  content: '',
  pinned: false,
  archived: false,
  tags: [] as string[],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const archivedNote = {
  ...activeNote,
  id: 'archived-note',
  title: 'Archived Note',
  archived: true,
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('NotesPage restore failure', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.post).mockReset()
  })

  it('shows user feedback when restoring an archived note fails', async () => {
    vi.mocked(api.get).mockImplementation((path: string) =>
      Promise.resolve(path === '/notes?archived=true' ? [archivedNote] : [activeNote]),
    )
    vi.mocked(api.post).mockRejectedValue(new Error('Restore failed'))
    const user = userEvent.setup()
    render(<NotesPage />, { wrapper: createWrapper() })
    await screen.findByText('Active Note')

    await user.click(screen.getByRole('button', { name: 'Архивные' }))
    await screen.findByText('Archived Note')
    await user.click(screen.getByRole('button', { name: /восстановить/i }))

    expect(await screen.findByText(/не удалось восстановить/i)).toBeInTheDocument()
  })
})
