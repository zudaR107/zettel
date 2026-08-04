import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }
const ADMIN = { Authorization: 'Bearer admin-token' }

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

interface UserRow {
  id: string
  email: string
  name: string
}

function selectUser(id: string): UserRow | undefined {
  return sqlite.prepare('SELECT id, email, name FROM users WHERE id = ?').get(id) as
    | UserRow
    | undefined
}

beforeEach(() => cleanDb())

describe('GET /users/me', () => {
  it('returns 401 without an Authorization header', async () => {
    const res = await app.request('/users/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 for an invalid token', async () => {
    const res = await get('/users/me', { Authorization: 'Bearer bad-token' })
    expect(res.status).toBe(401)
  })

  it('auto-provisions and returns the profile for a user seen for the first time', async () => {
    expect(selectUser('user-1')).toBeUndefined()

    const res = await get('/users/me', H1)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 'user-1', email: 'test@example.com', name: 'Test User' })

    // Auto-provisioning must have actually written the row, not just
    // returned it from the JWT claims in memory.
    expect(selectUser('user-1')).toEqual({
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
    })
  })

  it('returns the existing row unchanged for a pre-seeded user, without creating a duplicate', async () => {
    const now = Date.now()
    sqlite
      .prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .run('user-1', 'preexisting@example.com', 'Preexisting Name', now)

    const res = await get('/users/me', H1)
    expect(res.status).toBe(200)
    const body = await res.json()
    // The pre-seeded row wins - the token's JWT claims (test@example.com /
    // "Test User") must NOT have overwritten it.
    expect(body).toEqual({
      id: 'user-1',
      email: 'preexisting@example.com',
      name: 'Preexisting Name',
    })

    const rows = sqlite.prepare('SELECT * FROM users WHERE id = ?').all('user-1')
    expect(rows).toHaveLength(1)
  })

  it('does not create a duplicate row when the same user calls it twice', async () => {
    const first = await get('/users/me', H1)
    const second = await get('/users/me', H1)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toEqual(await second.json())

    const rows = sqlite.prepare('SELECT * FROM users WHERE id = ?').all('user-1')
    expect(rows).toHaveLength(1)
  })

  it('returns different, non-cross-contaminated profiles for two different users', async () => {
    const res1 = await get('/users/me', H1)
    const res2 = await get('/users/me', H2)
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)

    const body1 = (await res1.json()) as UserRow
    const body2 = (await res2.json()) as UserRow
    expect(body1.id).toBe('user-1')
    expect(body2.id).toBe('user-2')
    expect(body1.email).not.toBe(body2.email)
    expect(body1).not.toEqual(body2)

    // Both rows should independently exist in the db too.
    expect(selectUser('user-1')?.id).toBe('user-1')
    expect(selectUser('user-2')?.id).toBe('user-2')
  })
})

describe('GET /openapi.json', () => {
  it('returns 401 without an Authorization header', async () => {
    const res = await app.request('/openapi.json')
    expect(res.status).toBe(401)
  })

  it('returns 401 for an invalid token', async () => {
    const res = await get('/openapi.json', { Authorization: 'Bearer bad-token' })
    expect(res.status).toBe(401)
  })

  it('returns 403 with an explicit Forbidden error for a valid but non-admin token', async () => {
    const res = await get('/openapi.json', H1)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ error: 'Forbidden' })
  })

  it('returns 200 with a plausible OpenAPI document for a valid admin token', async () => {
    const res = await get('/openapi.json', ADMIN)
    expect(res.status).toBe(200)

    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body).toBe('object')
    expect(body).not.toBeNull()
    expect('openapi' in body || 'info' in body).toBe(true)
  })
})
