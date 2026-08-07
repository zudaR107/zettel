import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsPage } from '../features/settings/SettingsPage'

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
  exportedAt: '2026-08-06T12:00:00.000Z',
  scope: 'zettel',
  notes: [{ id: 'note-1', title: 'Download me', content: 'Body', archived: false, tags: [] }],
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(api.get).mockReset()
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/users/me') return Promise.resolve(profile)
    if (path === '/users/export') return Promise.resolve(exportedData)
    return Promise.reject(new Error(`Unexpected GET ${path}`))
  })
})

describe('SettingsPage — data export', () => {
  it('downloads the complete export endpoint response as a JSON file', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:zettel-export')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })

    let download = ''
    let href = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download
      href = this.href
    })

    render(<SettingsPage />, { wrapper: createWrapper() })
    await screen.findByText('Test User')

    await user.click(screen.getByRole('button', { name: /экспорт|скачать.*данн/i }))

    await vi.waitFor(() => expect(api.get).toHaveBeenCalledWith('/users/export'))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0]![0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/json')
    const contents = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error)
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    expect(JSON.parse(contents)).toEqual(exportedData)
    expect(href).toContain('blob:zettel-export')
    expect(download).toMatch(/\.json$/i)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:zettel-export')
  })
})
