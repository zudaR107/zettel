import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { router } from '../router'
import { queryClient } from '../lib/queryClient'
import { AuthContext } from '../hooks/useAuth'
import * as api from '../lib/api'
import * as authRedirect from '../lib/authRedirect'

// ---------------------------------------------------------------------------
// Exercises the real `router` singleton (the same one main.tsx renders)
// through RouterProvider, rather than reaching into route internals - the
// most faithful test of the actual auth-gating behavior.
//
// This scenario ("no token") lives in its own file, deliberately separate
// from the "token present" scenario (router.authenticated.test.tsx): the
// `router` object is a module-level singleton with its own async
// transition machinery (TanStack Router's internal "Transitioner") that
// keeps running after a test's render tree unmounts. Sharing one singleton
// across differently-mocked tests in the same file produced flaky,
// order-dependent results (confirmed by instrumenting both mocks - the
// second test intermittently observed calls that were really leftover
// continuations from the first test's still-in-flight transition, and
// React logged "not wrapped in act(...)" warnings for updates arriving
// after the test finished). Vitest gives each test *file* a fresh module
// registry, so a fresh `router` singleton per file sidesteps this
// entirely rather than trying to reset the shared instance mid-file.
//
// Only two leaves are mocked: `getAccessToken` (so we control whether a
// token is "present") and `buildSchluesselLoginUrl` (external platform
// code with its own tests elsewhere - here we only care that its return
// value ends up as `window.location.href`).
// ---------------------------------------------------------------------------

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, getAccessToken: vi.fn() }
})

vi.mock('../lib/authRedirect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authRedirect')>()
  return { ...actual, buildSchluesselLoginUrl: vi.fn() }
})

const dummyAuthValue = {
  user: { id: '1', email: 'a@a.com', name: 'A', role: 'user' },
  loading: false,
  logout: vi.fn(),
  setUser: vi.fn(),
}

function renderApp() {
  return render(
    <QueryClientProvider client={queryClient}>
      {/* @ts-expect-error -- test double; exact AuthUser shape is an implementation detail of hooks/useAuth.ts we deliberately don't import here */}
      <AuthContext.Provider value={dummyAuthValue}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

function stubLocationHref() {
  const original = window.location
  let hrefValue = ''
  // @ts-expect-error -- jsdom allows reassigning location for test purposes
  delete window.location
  // @ts-expect-error -- minimal stub: only intercepting `href` writes, so we
  // can assert on it without jsdom's "Not implemented: navigation" noise.
  window.location = {
    ...original,
    get href() { return hrefValue },
    set href(v: string) { hrefValue = v },
  }
  return () => {
    // @ts-expect-error -- restoring jsdom's original Location object
    window.location = original
  }
}

beforeEach(() => {
  window.history.pushState(null, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  queryClient.clear()
})

describe('router auth gating — no access token', () => {
  it('sends the browser to the schlussel login URL instead of rendering a protected page', async () => {
    vi.mocked(api.getAccessToken).mockReturnValue(null)
    vi.mocked(authRedirect.buildSchluesselLoginUrl).mockResolvedValue('https://schlussel.example.test/login?sentinel=1')
    const restoreLocation = stubLocationHref()

    renderApp()

    await waitFor(() => expect(window.location.href).toBe('https://schlussel.example.test/login?sentinel=1'))

    restoreLocation()
  })
})
