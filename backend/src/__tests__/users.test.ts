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

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  app.request(path, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const put = (path: string, body: unknown, headers: Record<string, string>) =>
  app.request(path, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const del = (path: string, headers: Record<string, string>) =>
  app.request(path, { method: 'DELETE', headers })

interface NoteApi {
  id: string
  title: string
  content: string
  pinned: boolean
  archived?: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

interface ExportBody {
  exportedAt: string
  scope: string
  notes: NoteApi[]
  [key: string]: unknown
}

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
    expect(body).toEqual({
      id: 'user-1', email: 'test@example.com', name: 'Test User',
      weekStart: 'sunday', dateFormat: 'ymd', timezone: 'Europe/Moscow',
    })

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
      weekStart: 'sunday', dateFormat: 'ymd', timezone: 'Europe/Moscow',
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

describe('GET /users/me — weekStart/dateFormat/timezone', () => {
  it("reads back the test-token user's fixture prefs exactly (weekStart: 'sunday', dateFormat: 'ymd', timezone: 'Europe/Moscow')", async () => {
    const res = await get('/users/me', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.weekStart).toBe('sunday')
    expect(body.dateFormat).toBe('ymd')
    expect(body.timezone).toBe('Europe/Moscow')
  })

  it("reads back null for all three for the user2-token user, who never set any preference", async () => {
    const res = await get('/users/me', H2)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.weekStart).toBeNull()
    expect(body.dateFormat).toBeNull()
    expect(body.timezone).toBeNull()
  })
})

describe('GET /users/export', () => {
  it('returns 401 without an Authorization header', async () => {
    const res = await app.request('/users/export')
    expect(res.status).toBe(401)
  })

  it('returns 401 for an invalid token', async () => {
    const res = await get('/users/export', { Authorization: 'Bearer bad-token' })
    expect(res.status).toBe(401)
  })

  it('returns exportedAt, a zettel-scoped `scope` string, and a notes array', async () => {
    const res = await get('/users/export', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportBody

    expect(typeof body.exportedAt).toBe('string')
    expect(Number.isNaN(new Date(body.exportedAt).getTime())).toBe(false)

    expect(typeof body.scope).toBe('string')
    expect(body.scope.toLowerCase()).toContain('zettel')

    expect(Array.isArray(body.notes)).toBe(true)
  })

  it('returns an empty notes array for a user with no notes', async () => {
    const res = await get('/users/export', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportBody
    expect(body.notes).toEqual([])
  })

  it('includes a created note with its title/content/pinned/archived/tags/createdAt/updatedAt', async () => {
    const createRes = await post(
      '/notes',
      { title: 'Export Test Note', content: 'Some body text', pinned: true },
      H1,
    )
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as NoteApi

    const putRes = await put(`/notes/${created.id}`, { tags: ['Work', 'Ideas'] }, H1)
    expect(putRes.status).toBe(200)
    const updated = (await putRes.json()) as NoteApi

    const res = await get('/users/export', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportBody

    const entry = body.notes.find((n) => n.title === 'Export Test Note')
    expect(entry).not.toBeUndefined()
    expect(entry?.content).toBe('Some body text')
    expect(entry?.pinned).toBe(true)
    expect(entry?.archived).toBe(false)
    expect(entry?.tags).toEqual(['Ideas', 'Work'])
    expect(entry?.createdAt).toBe(created.createdAt)
    expect(entry?.updatedAt).toBe(updated.updatedAt)
  })

  it('includes an archived note (unlike the default GET /notes list, which excludes archived notes)', async () => {
    const createRes = await post('/notes', { title: 'Archived Export Note', content: '' }, H1)
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as NoteApi

    const delRes = await del(`/notes/${created.id}`, H1)
    expect(delRes.status).toBeLessThan(300)

    // Sanity: it's genuinely gone from the regular list.
    const listRes = await get('/notes', H1)
    const listBody = (await listRes.json()) as NoteApi[]
    expect(listBody.map((n) => n.id)).not.toContain(created.id)

    const res = await get('/users/export', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportBody
    const entry = body.notes.find((n) => n.title === 'Archived Export Note')
    expect(entry).not.toBeUndefined()
    expect(entry?.archived).toBe(true)
  })

  it("never leaks another user's notes into this user's export", async () => {
    const mine = await post('/notes', { title: 'Mine Only', content: '' }, H1)
    expect(mine.status).toBe(201)
    const theirs = await post('/notes', { title: 'Not Mine', content: '' }, H2)
    expect(theirs.status).toBe(201)

    const res1 = await get('/users/export', H1)
    const body1 = (await res1.json()) as ExportBody
    expect(body1.notes.map((n) => n.title)).toContain('Mine Only')
    expect(body1.notes.map((n) => n.title)).not.toContain('Not Mine')

    const res2 = await get('/users/export', H2)
    const body2 = (await res2.json()) as ExportBody
    expect(body2.notes.map((n) => n.title)).toContain('Not Mine')
    expect(body2.notes.map((n) => n.title)).not.toContain('Mine Only')
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
