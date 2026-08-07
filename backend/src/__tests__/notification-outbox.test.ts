import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()
const H1 = { Authorization: 'Bearer test-token' }

interface OutboxRow {
  id: string
  event_type: string
  user_id: string
  payload: string
  correlation_id: string
  state: 'pending' | 'inflight' | 'delivered' | 'permanent'
  created_at: number
  attempts: number
  next_attempt_at: number | null
  delivered_at: number | null
  last_error: string | null
}

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

let noteCounter = 0

function hasOutboxTable(): boolean {
  return sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notification_outbox'")
    .get() !== undefined
}

function outboxRows(): OutboxRow[] {
  const exists = hasOutboxTable()
  expect(exists, 'migration must create notification_outbox').toBe(true)
  if (!exists) return []
  return sqlite.prepare('SELECT * FROM notification_outbox ORDER BY created_at, id').all() as OutboxRow[]
}

function ensureUser(id: string, email: string, name: string) {
  sqlite
    .prepare('INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .run(id, email, name, Date.now())
}

function insertNote(
  overrides: Partial<{
    id: string
    userId: string
    title: string
    content: string
    archived: boolean
    updatedAt: number
  }> = {},
): NoteRow {
  const now = Date.now()
  noteCounter += 1
  const note = {
    id: overrides.id ?? `notification-note-${noteCounter}`,
    userId: overrides.userId ?? 'user-1',
    title: overrides.title ?? '',
    content: overrides.content ?? '',
    archived: overrides.archived ?? false,
    updatedAt: overrides.updatedAt ?? now,
  }
  sqlite
    .prepare(`
      INSERT INTO notes (id, user_id, title, content, pinned, archived, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?)
    `)
    .run(
      note.id,
      note.userId,
      note.title,
      note.content,
      note.archived ? 1 : 0,
      now,
      note.updatedAt,
    )
  return sqlite.prepare('SELECT * FROM notes WHERE id = ?').get(note.id) as NoteRow
}

function putNote(id: string, body: unknown) {
  return app.request(`/notes/${id}`, {
    method: 'PUT',
    headers: { ...H1, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function noteTags(id: string): string[] {
  const rows = sqlite.prepare(`
    SELECT tags.name
    FROM note_tags
    INNER JOIN tags ON tags.id = note_tags.tag_id
    WHERE note_tags.note_id = ?
    ORDER BY tags.name
  `).all(id) as { name: string }[]
  return rows.map((row) => row.name)
}

beforeEach(() => {
  sqlite.exec('DROP TRIGGER IF EXISTS fail_notification_outbox_insert')
  if (hasOutboxTable()) sqlite.exec('DELETE FROM notification_outbox')
  cleanDb()
  ensureUser('user-1', 'test@example.com', 'Test User')
  ensureUser('user-2', 'test2@example.com', 'Test User 2')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PUT /notes/:id backlink notification outbox', () => {
  it('queues one versioned event per distinct newly introduced link to an active same-owner note', async () => {
    const source = insertNote({ title: 'Draft title', content: 'Existing text' })
    insertNote({ title: 'Alpha' })
    insertNote({ title: 'Beta' })

    const response = await putNote(source.id, {
      title: 'Source title',
      content: 'See [[Alpha]], [[Alpha]] again, and [[Beta]].',
    })

    expect(response.status).toBe(200)
    const rows = outboxRows()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => ({
      eventType: row.event_type,
      userId: row.user_id,
      payload: JSON.parse(row.payload) as unknown,
    }))).toEqual(expect.arrayContaining([
      {
        eventType: 'zettel.note.backlink_added.v1',
        userId: 'user-1',
        payload: { recipientId: 'user-1', sourceTitle: 'Source title', targetTitle: 'Alpha' },
      },
      {
        eventType: 'zettel.note.backlink_added.v1',
        userId: 'user-1',
        payload: { recipientId: 'user-1', sourceTitle: 'Source title', targetTitle: 'Beta' },
      },
    ]))
    for (const row of rows) {
      expect(row).toMatchObject({
        state: 'pending',
        attempts: 0,
        delivered_at: null,
        last_error: null,
      })
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      expect(row.correlation_id).toBe(row.id)
      expect(row.created_at).toBeGreaterThan(1_000_000_000_000)
      expect(row.next_attempt_at).toBe(row.created_at)
    }
  })

  it('does not queue again for an old link, duplicate mentions, or an identical save', async () => {
    const source = insertNote({ title: 'Source', content: 'Already linked: [[Alpha]]' })
    insertNote({ title: 'Alpha' })
    insertNote({ title: 'Beta' })
    const content = 'Still [[Alpha]], duplicated [[Alpha]], plus [[Beta]] and [[Beta]].'

    const first = await putNote(source.id, { content })
    expect(first.status).toBe(200)
    expect(outboxRows().map((row) => JSON.parse(row.payload))).toEqual([
      { recipientId: 'user-1', sourceTitle: 'Source', targetTitle: 'Beta' },
    ])

    const identical = await putNote(source.id, { content })
    expect(identical.status).toBe(200)
    expect(outboxRows()).toHaveLength(1)
  })

  it('ignores links to archived, cross-owner, self, empty-title, and unresolved targets', async () => {
    const source = insertNote({ title: 'Source' })
    insertNote({ title: 'Archived', archived: true })
    insertNote({ userId: 'user-2', title: 'Other owner' })
    insertNote({ title: '' })

    const response = await putNote(source.id, {
      content: '[[Archived]] [[Other owner]] [[Source]] [[]] [[Missing]]',
    })

    expect(response.status).toBe(200)
    expect(outboxRows()).toHaveLength(0)
  })

  it('queues the event without synchronously fetching Glocke', async () => {
    const source = insertNote({ title: 'Source' })
    insertNote({ title: 'Target' })
    const fetchMock = vi.fn().mockRejectedValue(new Error('Glocke is unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    const response = await putNote(source.id, { content: 'New link: [[Target]]' })

    expect(response.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(outboxRows()).toHaveLength(1)
  })

  it('rolls the note and tag synchronization back when the outbox insert fails', async () => {
    const oldUpdatedAt = Date.now() - 100_000
    const source = insertNote({
      title: 'Original source',
      content: 'Original content',
      updatedAt: oldUpdatedAt,
    })
    insertNote({ title: 'Target' })
    const seedTags = await putNote(source.id, { tags: ['Original tag'] })
    expect(seedTags.status).toBe(200)

    const exists = hasOutboxTable()
    expect(exists, 'migration must create notification_outbox').toBe(true)
    if (!exists) return
    sqlite.exec(`
      CREATE TRIGGER fail_notification_outbox_insert
      BEFORE INSERT ON notification_outbox
      BEGIN
        SELECT RAISE(ABORT, 'forced outbox failure');
      END
    `)

    let response: Response
    try {
      response = await putNote(source.id, {
        title: 'Changed source',
        content: 'Introduces [[Target]]',
        tags: ['Replacement tag'],
      })
    } finally {
      sqlite.exec('DROP TRIGGER IF EXISTS fail_notification_outbox_insert')
    }

    expect(response!.status).toBeGreaterThanOrEqual(500)
    expect(response!.status).toBeLessThan(600)
    expect(sqlite.prepare('SELECT * FROM notes WHERE id = ?').get(source.id)).toMatchObject({
      title: 'Original source',
      content: 'Original content',
      updated_at: oldUpdatedAt,
    })
    expect(noteTags(source.id)).toEqual(['Original tag'])
    expect(outboxRows()).toHaveLength(0)
  })
})
