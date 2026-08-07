import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { exportsRouter } from '../features/exports/router.js'
import { cleanDb, db, sqlite } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = (() => {
  const testApp = createTestApp()
  testApp.route('/exports', exportsRouter)
  return testApp
})()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }
const DELEGATED = { Authorization: 'Bearer zettel-export-delegation-token' }
const DELEGATED_H2 = { Authorization: 'Bearer zettel-export-user2-delegation-token' }
const WRONG_DELEGATION = { Authorization: 'Bearer kuvert-export-delegation-token' }

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

const post = (path: string, body: unknown, headers = H1) =>
  app.request(path, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const put = (path: string, body: unknown, headers = H1) =>
  app.request(path, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const del = (path: string, headers = H1) =>
  app.request(path, { method: 'DELETE', headers })

interface NoteExport {
  id: string
  title: string
  content: string
  pinned: boolean
  archived: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

interface TagExport {
  id: string
  name: string
  createdAt: string
}

interface ExportData {
  notes: NoteExport[]
  tags: TagExport[]
}

interface ExportEnvelope {
  version: '1'
  service: 'zettel'
  exportedAt: string
  data: ExportData
}

interface LegacyExport {
  exportedAt: string
  scope: 'zettel-account-only'
  notes: NoteExport[]
}

function expectPrivateExportHeaders(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('no-store, private')
  expect(response.headers.get('Pragma')).toBe('no-cache')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
}

beforeEach(() => cleanDb())
afterEach(() => vi.restoreAllMocks())

describe('GET /exports/me authentication', () => {
  it.each([
    ['a normal access token', H1],
    ['a Zettel-scoped export delegation', DELEGATED],
  ])('accepts %s and returns the standardized envelope', async (_label, headers) => {
    const res = await get('/exports/me', headers)
    expect(res.status).toBe(200)

    const body = (await res.json()) as ExportEnvelope
    expect(Object.keys(body).sort()).toEqual(['data', 'exportedAt', 'service', 'version'])
    expect(body).toEqual({
      version: '1',
      service: 'zettel',
      exportedAt: expect.any(String),
      data: { notes: [], tags: [] },
    })
    expect(new Date(body.exportedAt).toISOString()).toBe(body.exportedAt)
    expectPrivateExportHeaders(res)
  })

  it('rejects a missing token', async () => {
    const res = await get('/exports/me')
    expect(res.status).toBe(401)
  })

  it('rejects an export delegation intended for another service', async () => {
    const res = await get('/exports/me', WRONG_DELEGATION)
    expect(res.status).toBe(401)
  })

  it('does not grant a Zettel export delegation access to normal Zettel APIs', async () => {
    const res = await get('/notes', DELEGATED)
    expect(res.status).toBe(401)
  })

  it('does not grant a Zettel export delegation access to the retained legacy export', async () => {
    const res = await get('/users/export', DELEGATED)
    expect(res.status).toBe(401)
  })
})

describe('Zettel export snapshot', () => {
  it('retains the exact GET /users/export top-level shape and attached note tags', async () => {
    const created = await post('/notes', { title: 'Legacy export', content: '' })
    const note = (await created.json()) as NoteExport
    await put(`/notes/${note.id}`, { tags: ['Still attached', 'Now orphaned'] })
    await put(`/notes/${note.id}`, { tags: ['Still attached'] })

    const res = await get('/users/export', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as LegacyExport

    expect(Object.keys(body).sort()).toEqual(['exportedAt', 'notes', 'scope'])
    expect(body.scope).toBe('zettel-account-only')
    expect(body.notes).toHaveLength(1)
    expect(body.notes[0]).toMatchObject({ id: note.id, tags: ['Still attached'] })
    expectPrivateExportHeaders(res)
  })

  it('returns one transactional snapshot with active and archived notes, attached tags, and orphan tags', async () => {
    const activeRes = await post('/notes', {
      title: 'Active note', content: 'Active body', pinned: true,
    })
    const active = (await activeRes.json()) as NoteExport
    await put(`/notes/${active.id}`, { tags: ['Attached', 'Orphan'] })
    const activeUpdate = await put(`/notes/${active.id}`, { tags: ['Attached'] })
    const activeUpdated = (await activeUpdate.json()) as NoteExport

    const archivedRes = await post('/notes', {
      title: 'Archived note', content: 'Archived body', pinned: false,
    })
    const archived = (await archivedRes.json()) as NoteExport
    const archivedUpdate = await put(`/notes/${archived.id}`, { tags: ['Archive tag'] })
    const archivedUpdated = (await archivedUpdate.json()) as NoteExport
    expect((await del(`/notes/${archived.id}`)).status).toBe(200)

    const transaction = vi.spyOn(db, 'transaction')
    const res = await get('/exports/me', DELEGATED)

    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportEnvelope
    expect(body.version).toBe('1')
    expect(body.service).toBe('zettel')
    expect(new Date(body.exportedAt).toISOString()).toBe(body.exportedAt)
    expect(body.data.notes).toEqual(expect.arrayContaining([
      {
        id: active.id,
        title: 'Active note',
        content: 'Active body',
        pinned: true,
        archived: false,
        tags: ['Attached'],
        createdAt: active.createdAt,
        updatedAt: activeUpdated.updatedAt,
      },
      {
        id: archived.id,
        title: 'Archived note',
        content: 'Archived body',
        pinned: false,
        archived: true,
        tags: ['Archive tag'],
        createdAt: archived.createdAt,
        updatedAt: archivedUpdated.updatedAt,
      },
    ]))
    expect(body.data.notes).toHaveLength(2)
    expect(body.data.tags.map((tag) => tag.name).sort()).toEqual([
      'Archive tag', 'Attached', 'Orphan',
    ])
    for (const tag of body.data.tags) {
      expect(Object.keys(tag).sort()).toEqual(['createdAt', 'id', 'name'])
      expect(new Date(tag.createdAt).toISOString()).toBe(tag.createdAt)
    }

    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it("never includes another user's notes, tag relations, or orphan tag registry rows", async () => {
    const ownRes = await post('/notes', { title: 'Own note', content: '' }, H1)
    const own = (await ownRes.json()) as NoteExport
    await put(`/notes/${own.id}`, { tags: ['Own attached', 'Own orphan'] }, H1)
    await put(`/notes/${own.id}`, { tags: ['Own attached'] }, H1)

    const foreignRes = await post('/notes', { title: 'Foreign note', content: '' }, H2)
    const foreign = (await foreignRes.json()) as NoteExport
    await put(`/notes/${foreign.id}`, { tags: ['Foreign attached', 'Foreign orphan'] }, H2)
    await put(`/notes/${foreign.id}`, { tags: ['Foreign attached'] }, H2)

    const foreignTagIds = (sqlite
      .prepare("SELECT id FROM tags WHERE user_id = 'user-2'")
      .all() as Array<{ id: string }>).map((row) => row.id)

    const res = await get('/exports/me', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportEnvelope
    const serialized = JSON.stringify(body.data)

    expect(body.data.notes.map((note) => note.id)).toEqual([own.id])
    expect(body.data.tags.map((tag) => tag.name).sort()).toEqual(['Own attached', 'Own orphan'])
    expect(serialized).not.toContain(foreign.id)
    expect(serialized).not.toContain('Foreign attached')
    expect(serialized).not.toContain('Foreign orphan')
    for (const id of foreignTagIds) expect(serialized).not.toContain(id)
  })

  it('scopes a delegation from exportPrincipal.sub without an ordinary user context', async () => {
    const ownRes = await post('/notes', { title: 'Access principal note', content: '' }, H1)
    const own = (await ownRes.json()) as NoteExport
    const delegatedRes = await post('/notes', { title: 'Delegated principal note', content: '' }, H2)
    const delegated = (await delegatedRes.json()) as NoteExport
    await put(`/notes/${delegated.id}`, { tags: ['Delegated tag'] }, H2)

    const res = await get('/exports/me', DELEGATED_H2)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportEnvelope
    expect(body.data.notes.map((note) => note.id)).toEqual([delegated.id])
    expect(body.data.tags.map((tag) => tag.name)).toEqual(['Delegated tag'])
    expect(JSON.stringify(body.data)).not.toContain(own.id)
  })
})
