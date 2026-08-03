import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }

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

interface NoteRow {
  id: string
  user_id: string
  title: string
  content: string
  pinned: number
  archived: number
  created_at: number
  updated_at: number
}

interface NoteApi {
  id: string
  title: string
  content: string
  pinned: boolean
  [key: string]: unknown
}

function selectNote(id: string): NoteRow | undefined {
  return sqlite.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined
}

function ensureUser(id: string, email: string, name: string) {
  sqlite
    .prepare(
      'INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(id, email, name, Date.now())
}

let noteCounter = 0

function insertNote(
  overrides: Partial<{
    id: string
    userId: string
    title: string
    content: string
    pinned: boolean
    archived: boolean
    createdAt: number
    updatedAt: number
  }> = {},
): NoteRow {
  const now = Date.now()
  noteCounter += 1
  const note = {
    id: overrides.id ?? `note-${noteCounter}-${Math.random().toString(36).slice(2, 8)}`,
    userId: overrides.userId ?? 'user-1',
    title: overrides.title ?? '',
    content: overrides.content ?? '',
    pinned: overrides.pinned ?? false,
    archived: overrides.archived ?? false,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  }
  sqlite
    .prepare(
      'INSERT INTO notes (id, user_id, title, content, pinned, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      note.id,
      note.userId,
      note.title,
      note.content,
      note.pinned ? 1 : 0,
      note.archived ? 1 : 0,
      note.createdAt,
      note.updatedAt,
    )
  const row = selectNote(note.id)
  if (!row) throw new Error('failed to seed note')
  return row
}

beforeEach(() => {
  cleanDb()
  // Pre-seed both test users so raw-SQL note inserts (which carry a
  // user_id FK) don't need a prior HTTP round-trip to auto-provision them.
  ensureUser('user-1', 'test@example.com', 'Test User')
  ensureUser('user-2', 'test2@example.com', 'Test User 2')
})

describe('GET /notes', () => {
  it('returns an empty list for a user with no notes', async () => {
    const res = await get('/notes', H1)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns only the caller-owned, non-archived notes', async () => {
    const mine = insertNote({ userId: 'user-1', title: 'Mine' })
    insertNote({ userId: 'user-2', title: 'Not mine' })
    insertNote({ userId: 'user-1', title: 'Archived', archived: true })

    const res = await get('/notes', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as NoteApi[]
    expect(body.map((n) => n.id)).toEqual([mine.id])
  })

  it('filters by q against title OR content as a substring match', async () => {
    const titleMatch = insertNote({
      userId: 'user-1',
      title: 'Groceries List',
      content: 'buy stuff',
    })
    const contentMatch = insertNote({
      userId: 'user-1',
      title: 'Meeting notes',
      content: 'discuss groceries budget',
    })
    insertNote({ userId: 'user-1', title: 'Unrelated', content: 'nothing here' })

    const res = await get('/notes?q=groceries', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as NoteApi[]
    const ids = body.map((n) => n.id).sort()
    expect(ids).toEqual([titleMatch.id, contentMatch.id].sort())
  })

  it('LIKE matching for q is case-insensitive for ASCII (as SQLite LIKE is by default)', async () => {
    const note = insertNote({ userId: 'user-1', title: 'Groceries List', content: '' })

    const res = await get('/notes?q=GROCERIES', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as NoteApi[]
    expect(body.map((n) => n.id)).toEqual([note.id])
  })

  it('does not match notes when q does not appear in title or content', async () => {
    insertNote({ userId: 'user-1', title: 'Groceries List', content: 'milk, eggs' })

    const res = await get('/notes?q=xyzzy-not-present', H1)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('sorts pinned notes first, then by updatedAt descending within each group', async () => {
    const base = Date.now() - 1_000_000
    const unpinnedOld = insertNote({ userId: 'user-1', pinned: false, updatedAt: base + 1000 })
    const unpinnedNew = insertNote({ userId: 'user-1', pinned: false, updatedAt: base + 3000 })
    const pinnedOld = insertNote({ userId: 'user-1', pinned: true, updatedAt: base + 2000 })
    const pinnedNew = insertNote({ userId: 'user-1', pinned: true, updatedAt: base + 4000 })

    const res = await get('/notes', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as NoteApi[]
    expect(body.map((n) => n.id)).toEqual([
      pinnedNew.id,
      pinnedOld.id,
      unpinnedNew.id,
      unpinnedOld.id,
    ])
  })
})

describe('POST /notes', () => {
  it('creates a note with the given fields and returns 201 with a generated id', async () => {
    const res = await post('/notes', { title: 'Groceries', content: 'Milk, eggs', pinned: true }, H1)
    expect(res.status).toBe(201)
    const body = (await res.json()) as NoteApi
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
    expect(body.title).toBe('Groceries')
    expect(body.content).toBe('Milk, eggs')
    expect(body.pinned).toBe(true)

    const row = selectNote(body.id)
    expect(row).not.toBeUndefined()
    expect(row?.user_id).toBe('user-1')
  })

  it('defaults title/content to empty string and pinned to false when omitted', async () => {
    const res = await post('/notes', {}, H1)
    expect(res.status).toBe(201)
    const body = (await res.json()) as NoteApi
    expect(body.title).toBe('')
    expect(body.content).toBe('')
    expect(body.pinned).toBe(false)
  })

  it("creates the note under the caller's own user id, not a different one", async () => {
    const res = await post('/notes', { title: 'A' }, H2)
    expect(res.status).toBe(201)
    const body = (await res.json()) as NoteApi
    const row = selectNote(body.id)
    expect(row?.user_id).toBe('user-2')
  })
})

describe('GET /notes/:id', () => {
  it('fetches a note owned by the caller', async () => {
    const note = insertNote({ userId: 'user-1', title: 'Mine', content: 'Body' })
    const res = await get(`/notes/${note.id}`, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as NoteApi
    expect(body.id).toBe(note.id)
    expect(body.title).toBe('Mine')
    expect(body.content).toBe('Body')
  })

  it('returns 404 for a nonexistent note id', async () => {
    const res = await get('/notes/totally-fake-id', H1)
    expect(res.status).toBe(404)
  })

  it("returns 404 for a note that exists but belongs to a different user (no existence leak)", async () => {
    const note = insertNote({ userId: 'user-1' })
    const resOther = await get(`/notes/${note.id}`, H2)
    const resMissing = await get('/notes/totally-fake-id', H2)

    expect(resOther.status).toBe(404)
    expect(resMissing.status).toBe(404)
    expect(await resOther.json()).toEqual(await resMissing.json())
  })
})

describe('PUT /notes/:id', () => {
  it('updates only the provided field(s), leaving the rest completely unchanged', async () => {
    const note = insertNote({
      userId: 'user-1',
      title: 'Original title',
      content: 'Original content',
      pinned: false,
    })

    const res = await put(`/notes/${note.id}`, { pinned: true }, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as NoteApi
    expect(body.pinned).toBe(true)
    expect(body.title).toBe('Original title')
    expect(body.content).toBe('Original content')

    const row = selectNote(note.id)
    expect(row?.title).toBe('Original title')
    expect(row?.content).toBe('Original content')
    expect(row?.pinned).toBe(1)
  })

  it('updating title/content does not reset pinned', async () => {
    const note = insertNote({ userId: 'user-1', pinned: true, title: 'A', content: 'B' })
    const res = await put(`/notes/${note.id}`, { title: 'New title' }, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as NoteApi
    expect(body.title).toBe('New title')
    expect(body.content).toBe('B')
    expect(body.pinned).toBe(true)
  })

  it('bumps updatedAt on every successful update, even if only pinned changed', async () => {
    const past = Date.now() - 1_000_000
    const note = insertNote({ userId: 'user-1', updatedAt: past })

    const res = await put(`/notes/${note.id}`, { pinned: true }, H1)
    expect(res.status).toBe(200)

    const row = selectNote(note.id)
    expect(row?.updated_at).toBeGreaterThan(past)
  })

  it('returns 404 for a nonexistent note id', async () => {
    const res = await put('/notes/totally-fake-id', { pinned: true }, H1)
    expect(res.status).toBe(404)
  })

  it("returns 404 and does not modify the note when it belongs to a different user", async () => {
    const note = insertNote({ userId: 'user-1', title: 'Mine', content: 'Secret' })
    const res = await put(`/notes/${note.id}`, { title: 'Hacked', content: 'Hacked body' }, H2)
    expect(res.status).toBe(404)

    const row = selectNote(note.id)
    expect(row?.title).toBe('Mine')
    expect(row?.content).toBe('Secret')
  })
})

describe('DELETE /notes/:id', () => {
  it('archives the note (soft delete) instead of removing the row', async () => {
    const note = insertNote({ userId: 'user-1' })
    const res = await del(`/notes/${note.id}`, H1)
    expect(res.status).toBeLessThan(300)

    const row = selectNote(note.id)
    expect(row).not.toBeUndefined()
    expect(row?.archived).toBe(1)
  })

  it('makes the note disappear from GET /notes afterward', async () => {
    const note = insertNote({ userId: 'user-1' })
    const delRes = await del(`/notes/${note.id}`, H1)
    expect(delRes.status).toBeLessThan(300)

    const res = await get('/notes', H1)
    const body = (await res.json()) as NoteApi[]
    expect(body.map((n) => n.id)).not.toContain(note.id)
  })

  it('returns 404 for a nonexistent note id', async () => {
    const res = await del('/notes/totally-fake-id', H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 and does not archive the note when it belongs to a different user', async () => {
    const note = insertNote({ userId: 'user-1' })
    const res = await del(`/notes/${note.id}`, H2)
    expect(res.status).toBe(404)

    const row = selectNote(note.id)
    expect(row?.archived).toBe(0)
  })
})

describe('authentication', () => {
  const targetId = 'note-does-not-exist'
  const jsonHeaders = { 'Content-Type': 'application/json' }

  const cases: [string, string, RequestInit][] = [
    ['GET', '/notes', {}],
    ['POST', '/notes', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({}) }],
    ['GET', `/notes/${targetId}`, {}],
    [
      'PUT',
      `/notes/${targetId}`,
      { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ pinned: true }) },
    ],
    ['DELETE', `/notes/${targetId}`, { method: 'DELETE' }],
  ]

  it.each(cases)('returns 401 for %s %s with no Authorization header', async (_method, path, init) => {
    const res = await app.request(path, init)
    expect(res.status).toBe(401)
  })

  it.each(cases)('returns 401 for %s %s with an invalid token', async (_method, path, init) => {
    const res = await app.request(path, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: 'Bearer bad-token' },
    })
    expect(res.status).toBe(401)
  })
})
