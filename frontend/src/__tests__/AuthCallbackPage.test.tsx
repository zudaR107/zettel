import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { AuthCallbackPage } from '../features/auth/AuthCallbackPage'
import { AuthContext } from '../hooks/useAuth'
import { CODE_VERIFIER_STORAGE_KEY } from '../lib/authRedirect'
import * as api from '../lib/api'

const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

function setLocation(search: string) {
  const original = window.location
  // @ts-expect-error -- jsdom allows reassigning location for test purposes
  delete window.location
  // @ts-expect-error -- minimal stub covering what the component under test reads
  window.location = { ...original, search, pathname: '/auth/callback' }
  return () => {
    // @ts-expect-error -- restoring jsdom's original Location object
    window.location = original
  }
}

function renderCallback(setUser = vi.fn()) {
  return render(
    <AuthContext.Provider value={{ user: null, loading: false, logout: vi.fn(), setUser }}>
      <AuthCallbackPage />
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  mockNavigate.mockClear()
  sessionStorage.clear()
  vi.spyOn(api, 'setAccessToken')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AuthCallbackPage — no code in the query string', () => {
  it('navigates to "next" immediately, without making any network request', async () => {
    const restore = setLocation('?next=%2Fsettings')
    renderCallback()

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(mockNavigate.mock.calls[0][0]).toMatchObject({ to: '/settings' })
    expect(fetch).not.toHaveBeenCalled()
    expect(api.setAccessToken).not.toHaveBeenCalled()
    restore()
  })

  it('defaults to /notes when there is no "next" param either', async () => {
    const restore = setLocation('')
    renderCallback()

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(mockNavigate.mock.calls[0][0]).toMatchObject({ to: '/notes' })
    restore()
  })
})

describe('AuthCallbackPage — code present but no stored verifier', () => {
  it('behaves like "no code": navigates to next without fetching or setting the token', async () => {
    sessionStorage.clear()
    const restore = setLocation('?code=abc123&next=%2Fsettings')
    renderCallback()

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(mockNavigate.mock.calls[0][0]).toMatchObject({ to: '/settings' })
    expect(fetch).not.toHaveBeenCalled()
    expect(api.setAccessToken).not.toHaveBeenCalled()
    restore()
  })
})

describe('AuthCallbackPage — code + stored verifier present', () => {
  it('POSTs to /auth/token with the code and stored verifier', async () => {
    sessionStorage.setItem(CODE_VERIFIER_STORAGE_KEY, 'stored-verifier')
    const restore = setLocation('?code=abc123')
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'real-token', user: { id: '1' } }),
    } as Response)
    renderCallback()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/auth/token')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init?.body as string)
    expect(body).toEqual({ code: 'abc123', codeVerifier: 'stored-verifier' })
    restore()
  })

  it('sets the access token and user only after the exchange resolves successfully', async () => {
    sessionStorage.setItem(CODE_VERIFIER_STORAGE_KEY, 'stored-verifier')
    const restore = setLocation('?code=abc123&next=%2Fsettings')
    const user = { id: '1', email: 'a@a.com' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'real-token', user }),
    } as Response)
    const setUser = vi.fn()
    renderCallback(setUser)

    await waitFor(() => expect(api.setAccessToken).toHaveBeenCalledWith('real-token'))
    await waitFor(() => expect(setUser).toHaveBeenCalledWith(user))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(mockNavigate.mock.calls[0][0]).toMatchObject({ to: '/settings' })
    restore()
  })

  it('does not call setAccessToken synchronously before the fetch resolves', () => {
    sessionStorage.setItem(CODE_VERIFIER_STORAGE_KEY, 'stored-verifier')
    const restore = setLocation('?code=abc123')
    // Never-resolving fetch: if setAccessToken were called synchronously,
    // it would already have happened by now.
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    renderCallback()

    expect(api.setAccessToken).not.toHaveBeenCalled()
    restore()
  })

  it('does not set the token or user on a non-ok response, but still navigates to next', async () => {
    sessionStorage.setItem(CODE_VERIFIER_STORAGE_KEY, 'stored-verifier')
    const restore = setLocation('?code=abc123&next=%2Fsettings')
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)
    const setUser = vi.fn()
    renderCallback(setUser)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(mockNavigate.mock.calls[0][0]).toMatchObject({ to: '/settings' })
    expect(api.setAccessToken).not.toHaveBeenCalled()
    expect(setUser).not.toHaveBeenCalled()
    restore()
  })

  it('does not set the token or user when the fetch rejects, but still navigates to next', async () => {
    sessionStorage.setItem(CODE_VERIFIER_STORAGE_KEY, 'stored-verifier')
    const restore = setLocation('?code=abc123&next=%2Fsettings')
    vi.mocked(fetch).mockRejectedValue(new Error('network error'))
    const setUser = vi.fn()
    renderCallback(setUser)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(mockNavigate.mock.calls[0][0]).toMatchObject({ to: '/settings' })
    expect(api.setAccessToken).not.toHaveBeenCalled()
    expect(setUser).not.toHaveBeenCalled()
    restore()
  })

  it('removes the code from the visible URL via history.replaceState', () => {
    sessionStorage.setItem(CODE_VERIFIER_STORAGE_KEY, 'stored-verifier')
    const replaceStateSpy = vi.spyOn(history, 'replaceState')
    const restore = setLocation('?code=abc123')
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    renderCallback()

    expect(replaceStateSpy).toHaveBeenCalled()
    const [, , url] = replaceStateSpy.mock.calls[0]
    expect(String(url)).not.toContain('code=')
    replaceStateSpy.mockRestore()
    restore()
  })

  it('clears the stored verifier from sessionStorage after a successful exchange', async () => {
    sessionStorage.setItem(CODE_VERIFIER_STORAGE_KEY, 'stored-verifier')
    const restore = setLocation('?code=abc123')
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'real-token', user: { id: '1' } }),
    } as Response)
    renderCallback()

    await waitFor(() => expect(api.setAccessToken).toHaveBeenCalled())
    expect(sessionStorage.getItem(CODE_VERIFIER_STORAGE_KEY)).toBeNull()
    restore()
  })
})
