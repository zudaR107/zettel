import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

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

function selectNote(id: string): NoteRow | undefined {
  return sqlite.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined
}

function ensureUser(id: string, email: string, name: string) {
  sqlite
    .prepare('INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
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
  ensureUser('user-1', 'test@example.com', 'Test User')
  ensureUser('user-2', 'test2@example.com', 'Test User 2')
})

describe('GET /tags', () => {
  it('returns 401 without a valid bearer token', async () => {
    const res = await app.request('/tags')
    expect(res.status).toBe(401)
  })

  it('returns 401 for an invalid token', async () => {
    const res = await get('/tags', { Authorization: 'Bearer bad-token' })
    expect(res.status).toBe(401)
  })

  it('returns [] for a user with no tags', async () => {
    const res = await get('/tags', H1)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns tags currently attached to at least one non-archived note, sorted alphabetically', async () => {
    const note = insertNote({ userId: 'user-1' })
    const putRes = await put(`/notes/${note.id}`, { tags: ['Zebra', 'Apple', 'Mango'] }, H1)
    expect(putRes.status).toBe(200)

    const res = await get('/tags', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; name: string }[]
    expect(body.map((t) => t.name)).toEqual(['Apple', 'Mango', 'Zebra'])
    for (const t of body) {
      expect(typeof t.id).toBe('string')
      expect(t.id.length).toBeGreaterThan(0)
    }
  })

  it('does not include a tag once no non-archived note carries it anymore', async () => {
    const noteWithTag = insertNote({ userId: 'user-1' })
    await put(`/notes/${noteWithTag.id}`, { tags: ['Solo'] }, H1)

    let res = await get('/tags', H1)
    expect((await res.json()) as { name: string }[]).toEqual([{ name: 'Solo', id: expect.any(String) }])

    // Removing the tag from the only note carrying it.
    await put(`/notes/${noteWithTag.id}`, { tags: [] }, H1)
    res = await get('/tags', H1)
    expect(await res.json()).toEqual([])
  })

  it('returns [] if all of the user\'s tagged notes are archived', async () => {
    const note = insertNote({ userId: 'user-1' })
    await put(`/notes/${note.id}`, { tags: ['Solo'] }, H1)
    const delRes = await del(`/notes/${note.id}`, H1)
    expect(delRes.status).toBeLessThan(300)

    const res = await get('/tags', H1)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('never includes another user\'s tags, even with a same-named tag', async () => {
    const note1 = insertNote({ userId: 'user-1' })
    const note2 = insertNote({ userId: 'user-2' })
    await put(`/notes/${note1.id}`, { tags: ['Work'] }, H1)
    await put(`/notes/${note2.id}`, { tags: ['Work'] }, H2)

    const res1 = await get('/tags', H1)
    const body1 = (await res1.json()) as { id: string; name: string }[]
    expect(body1.map((t) => t.name)).toEqual(['Work'])

    const res2 = await get('/tags', H2)
    const body2 = (await res2.json()) as { id: string; name: string }[]
    expect(body2.map((t) => t.name)).toEqual(['Work'])

    // Independent tag records - not the same underlying id.
    expect(body1[0]?.id).not.toBe(body2[0]?.id)
  })
})

describe('DELETE /notes/:id — archiving a tagged note', () => {
  it('archives a tagged note without erroring', async () => {
    const note = insertNote({ userId: 'user-1' })
    await put(`/notes/${note.id}`, { tags: ['Solo', 'Other'] }, H1)

    const res = await del(`/notes/${note.id}`, H1)
    expect(res.status).toBeLessThan(300)
    const row = selectNote(note.id)
    expect(row?.archived).toBe(1)
  })

  it('silently drops a tag from GET /tags once its only note is archived, without affecting an unrelated still-active tag', async () => {
    const soloNote = insertNote({ userId: 'user-1' })
    const otherNote = insertNote({ userId: 'user-1' })
    await put(`/notes/${soloNote.id}`, { tags: ['Solo'] }, H1)
    await put(`/notes/${otherNote.id}`, { tags: ['Stays'] }, H1)

    const delRes = await del(`/notes/${soloNote.id}`, H1)
    expect(delRes.status).toBeLessThan(300)

    const res = await get('/tags', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string }[]
    expect(body.map((t) => t.name)).toEqual(['Stays'])
  })
})
