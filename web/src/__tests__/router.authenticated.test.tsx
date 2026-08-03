import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor, screen } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { router } from '../router'
import { queryClient } from '../lib/queryClient'
import { AuthContext } from '../hooks/useAuth'
import * as api from '../lib/api'
import * as authRedirect from '../lib/authRedirect'

// See router.noToken.test.tsx for why this scenario has its own file rather
// than sharing one with the "no token" case: the `router` singleton's async
// transition machinery outlives a single test's render, so mixing
// differently-mocked scenarios against the same singleton in one file was
// flaky. A fresh test file gives a fresh module registry and thus a fresh
// `router` singleton.

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

beforeEach(() => {
  window.history.pushState(null, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  queryClient.clear()
})

describe('router auth gating — access token present', () => {
  it('redirects "/" to "/notes" and renders the protected layout with its child route', async () => {
    vi.mocked(api.getAccessToken).mockReturnValue('real-token')

    renderApp()

    await waitFor(() => expect(router.state.location.pathname).toBe('/notes'))
    // buildSchluesselLoginUrl must never be consulted when a token is present.
    expect(authRedirect.buildSchluesselLoginUrl).not.toHaveBeenCalled()
    // The protected layout's children (NotesPage) actually render - the
    // page isn't blocked behind the auth gate. We deliberately don't assert
    // on NotesPage's placeholder copy (milestone 1 scaffold, about to be
    // rewritten); we only assert that *something* rendered into the DOM
    // instead of the tree staying empty/blocked, and that we didn't
    // instead land on anything login-related.
    await waitFor(() => expect(document.body.textContent?.trim().length).toBeGreaterThan(0))
    expect(screen.queryByText(/schlussel|login/i)).not.toBeInTheDocument()
  })
})
