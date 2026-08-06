import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from '../components/Layout'

// ---------------------------------------------------------------------------
// This test file was written from a black-box behavioral spec, without
// reading src/components/Layout.tsx's implementation of the sidebar's
// tag-folder list (per this project's rule that new-feature tests are
// authored blind to the implementation). Conventions (api mock shape, router
// mock shape, QueryClientProvider wrapper) are copied from the pre-existing
// NotesPage.test.tsx / QuickSwitcher.test.tsx, which were fine to read.
//
// ../hooks/useAuth and ../hooks/useToast are mocked directly since Layout
// uses both (confirmed only by grepping the two `useAuth()` / `useToast()`
// call-site lines in Layout.tsx, not by reading its render logic) - their
// mocked shapes come from reading the pre-existing hook implementations
// (src/hooks/useAuth.ts re-exports @zudar107/schloss-ui's AuthState:
// { user, loading, logout, setUser }; src/hooks/useToast.ts returns
// { toast, showSuccess, showError, dismiss }), which is fine since those are
// pre-existing utility hooks, not the new feature.
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
const mockUseSearch = vi.fn(() => ({}) as Record<string, unknown>)
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
  useSearch: () => mockUseSearch(),
  useLocation: () => ({ pathname: '/notes' }),
  // Same anchor-stub convention as the other test files, extended to also
  // surface a `search` prop (TanStack Router's declarative way to carry
  // query params on a <Link>) as a `data-search` attribute, JSON-serialized,
  // so tests can inspect which search params a given tag's link carries.
  // Tolerant of `search` being passed either as a plain object or as an
  // updater function `(prev) => next`, per TanStack Router's API.
  Link: (props: Record<string, unknown>) => {
    const { to, children, search, ...rest } = props as {
      to: unknown
      children?: React.ReactNode
      search?: unknown
      [k: string]: unknown
    }
    const toStr = typeof to === 'string' ? to : JSON.stringify(to)
    let searchStr: string | undefined
    if (search !== undefined) {
      const resolved =
        typeof search === 'function' ? (search as (prev: Record<string, unknown>) => unknown)({}) : search
      searchStr = JSON.stringify(resolved)
    }
    return (
      <a href={toStr} data-search={searchStr} {...(rest as Record<string, unknown>)}>
        {children as React.ReactNode}
      </a>
    )
  },
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Test User', email: 'test@example.com', role: 'user' },
    loading: false,
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}))

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ toast: null, showSuccess: vi.fn(), showError: vi.fn(), dismiss: vi.fn() }),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const tagFixture = [
  { id: 't1', name: 'work' },
  { id: 't2', name: 'ideas' },
]

function mockApiGet(overrides: { tags?: unknown[] } = {}) {
  const tagsList = overrides.tags ?? tagFixture
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/tags') return Promise.resolve(tagsList)
    return Promise.resolve([])
  })
}

beforeEach(() => {
  mockNavigate.mockClear()
  mockUseSearch.mockReset()
  mockUseSearch.mockReturnValue({})
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
  mockApiGet()
})

// ---------------------------------------------------------------------------
// Every fetched tag appears as a navigable element
// ---------------------------------------------------------------------------
describe('Layout — sidebar tag-folder list', () => {
  it('renders every tag name fetched from GET /tags as a distinct clickable/navigable element', async () => {
    render(
      <Layout>
        <div>test content</div>
      </Layout>,
      { wrapper: createWrapper() },
    )

    const workLinks = await screen.findAllByRole('link', { name: /work/i })
    const ideasLinks = screen.getAllByRole('link', { name: /ideas/i })
    expect(workLinks.length).toBeGreaterThan(0)
    expect(ideasLinks.length).toBeGreaterThan(0)
  })

  it("each tag's link target carries that tag's own name as a `tag` search param, not a shared/hardcoded one", async () => {
    render(
      <Layout>
        <div>test content</div>
      </Layout>,
      { wrapper: createWrapper() },
    )

    const workLinks = await screen.findAllByRole('link', { name: /^work$/i })
    const ideasLinks = screen.getAllByRole('link', { name: /^ideas$/i })
    expect(workLinks.length).toBeGreaterThan(0)
    expect(ideasLinks.length).toBeGreaterThan(0)

    for (const link of workLinks) {
      const search = link.getAttribute('data-search') ?? ''
      const href = link.getAttribute('href') ?? ''
      const carriesWork = /tag["']?\s*[:=]\s*["']?work/i.test(search) || /tag=work/i.test(href)
      expect(carriesWork).toBe(true)
      // Must genuinely be scoped to "work", not "ideas".
      expect(/ideas/i.test(search) || /tag=ideas/i.test(href)).toBe(false)
    }

    for (const link of ideasLinks) {
      const search = link.getAttribute('data-search') ?? ''
      const href = link.getAttribute('href') ?? ''
      const carriesIdeas = /tag["']?\s*[:=]\s*["']?ideas/i.test(search) || /tag=ideas/i.test(href)
      expect(carriesIdeas).toBe(true)
      expect(/work/i.test(search) || /tag=work/i.test(href)).toBe(false)
    }
  })

  it('renders no tag-related section/heading when zero tags exist, and does not crash', async () => {
    mockApiGet({ tags: [] })
    render(
      <Layout>
        <div>test content</div>
      </Layout>,
      { wrapper: createWrapper() },
    )

    // Give the /tags fetch a tick to resolve.
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledWith('/tags'))
    await screen.findByText('test content')

    // No "Tags"/"Теги" heading, and no leftover tag chips from the shared
    // fixture (this test deliberately overrides the beforeEach fixture).
    expect(screen.queryByText(/^tags$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^теги$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^work$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^ideas$/i })).not.toBeInTheDocument()
  })

  it('visually distinguishes the currently-active tag from the others', async () => {
    mockUseSearch.mockReturnValue({ tag: 'work' })
    render(
      <Layout>
        <div>test content</div>
      </Layout>,
      { wrapper: createWrapper() },
    )

    const workLinks = await screen.findAllByRole('link', { name: /^work$/i })
    const ideasLinks = screen.getAllByRole('link', { name: /^ideas$/i })
    expect(workLinks.length).toBeGreaterThan(0)
    expect(ideasLinks.length).toBeGreaterThan(0)

    const activeLink = workLinks[0] as HTMLElement
    const inactiveLink = ideasLinks[0] as HTMLElement

    // Pragmatic black-box check: compare a handful of commonly-used
    // "active state" signals and require at least one to differ.
    const ariaCurrentDiffers = activeLink.getAttribute('aria-current') !== inactiveLink.getAttribute('aria-current')
    const classDiffers = activeLink.className !== inactiveLink.className
    const fontWeightDiffers = activeLink.style.fontWeight !== inactiveLink.style.fontWeight
    const colorDiffers = activeLink.style.color !== inactiveLink.style.color
    const backgroundDiffers = activeLink.style.background !== inactiveLink.style.background

    const distinguished =
      ariaCurrentDiffers || classDiffers || fontWeightDiffers || colorDiffers || backgroundDiffers
    expect(distinguished).toBe(true)
  })
})
