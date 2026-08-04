import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

describe('GET /health', () => {
  it('succeeds with no Authorization header at all', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status?: string; service?: string }
    expect(body.status).toBe('ok')
    expect(body.service).toBe('Zettel')
  })

  it('succeeds even with a garbage Authorization header', async () => {
    const res = await app.request('/health', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status?: string; service?: string }
    expect(body.status).toBe('ok')
    expect(body.service).toBe('Zettel')
  })
})
