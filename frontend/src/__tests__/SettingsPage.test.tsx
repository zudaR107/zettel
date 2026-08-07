import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsPage } from '../features/settings/SettingsPage'

const sharedExportMocks = vi.hoisted(() => ({
  downloadJson: vi.fn(),
  directExportAction: vi.fn(),
}))

vi.mock('@zudar107/schloss-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zudar107/schloss-ui')>()
  return {
    ...actual,
    downloadJson: sharedExportMocks.downloadJson,
    DirectExportAction: (props: {
      title: string
      description: string
      actionLabel: string
      loadingLabel: string
      loading?: boolean
      error?: string | null
      onExport: () => void
    }) => {
      sharedExportMocks.directExportAction(props)
      return (
        <section>
          <h2>{props.title}</h2>
          <p>{props.description}</p>
          <button type="button" disabled={props.loading} onClick={props.onExport}>
            {props.loading ? props.loadingLabel : props.actionLabel}
          </button>
          {props.error && <p role="alert">{props.error}</p>}
        </section>
      )
    },
  }
})

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import { api } from '../lib/api'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const profile = { id: 'user-1', email: 'test@example.com', name: 'Test User' }
const exportedData = {
  version: '1',
  service: 'zettel',
  exportedAt: '2026-08-06T12:00:00.000Z',
  data: {
    notes: [{ id: 'note-1', title: 'Download me', content: 'Body', archived: false, tags: [] }],
    tags: [],
  },
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(api.get).mockReset()
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/users/me') return Promise.resolve(profile)
    if (path === '/exports/me') return Promise.resolve(exportedData)
    return Promise.reject(new Error(`Unexpected GET ${path}`))
  })
  sharedExportMocks.downloadJson.mockReset()
  sharedExportMocks.directExportAction.mockClear()
})

describe('SettingsPage — data export', () => {
  it('uses the shared direct-export action and JSON download helper for GET /exports/me', async () => {
    const user = userEvent.setup()

    render(<SettingsPage />, { wrapper: createWrapper() })
    await screen.findByText('Test User')

    await user.click(screen.getByRole('button', { name: /экспорт|скачать.*данн/i }))

    await vi.waitFor(() => expect(api.get).toHaveBeenCalledWith('/exports/me'))
    expect(sharedExportMocks.directExportAction).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringMatching(/данн|экспорт/i),
      description: expect.stringMatching(/json|замет|тег/i),
      actionLabel: expect.stringMatching(/экспорт|скачать/i),
      onExport: expect.any(Function),
    }))
    expect(sharedExportMocks.downloadJson).toHaveBeenCalledWith(
      exportedData,
      expect.stringMatching(/^zettel-export-\d{4}-\d{2}-\d{2}\.json$/),
    )
  })
})
