import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))

import { cleanDb, sqlite } from './helpers/db.js'
import { startNotificationOutbox } from '../notifications/outbox.js'

interface OutboxRow {
  id: string
  event_type: string
  user_id: string
  payload: string
  correlation_id: string
  state: string
  created_at: number
  attempts: number
  next_attempt_at: number | null
  lease_id: string | null
  lease_until: number | null
  delivered_at: number | null
  last_error: string | null
}

const KEY_ID_VAR = 'ZETTEL_TO_GLOCKE_HMAC_KEY_ID'
const SECRET_VAR = 'ZETTEL_TO_GLOCKE_HMAC_SECRET'

let savedKeyId: string | undefined
let savedSecret: string | undefined

beforeEach(() => {
  cleanDb()
  sqlite.exec('DELETE FROM notification_outbox')
  savedKeyId = process.env[KEY_ID_VAR]
  savedSecret = process.env[SECRET_VAR]
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (savedKeyId === undefined) delete process.env[KEY_ID_VAR]
  else process.env[KEY_ID_VAR] = savedKeyId
  if (savedSecret === undefined) delete process.env[SECRET_VAR]
  else process.env[SECRET_VAR] = savedSecret
})

function configureCredentials() {
  process.env[KEY_ID_VAR] = 'test-key'
  process.env[SECRET_VAR] = 'a'.repeat(32)
}

function clearCredentials() {
  delete process.env[KEY_ID_VAR]
  delete process.env[SECRET_VAR]
}

/** Seed one row directly into notification_outbox via raw SQL, mirroring the
 * sibling test file's own style, rather than going through any application
 * code path - this suite tests delivery of an already-queued row, not the
 * note-save code path that creates one. */
function seedRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  const now = Date.now()
  const row: OutboxRow = {
    id: crypto.randomUUID(),
    event_type: 'zettel.note.backlink_added.v1',
    user_id: 'user-1',
    payload: JSON.stringify({ recipientId: 'user-1', sourceTitle: 'Source', targetTitle: 'Target' }),
    correlation_id: crypto.randomUUID(),
    state: 'pending',
    created_at: now - 1_000,
    attempts: 0,
    next_attempt_at: now - 1_000,
    lease_id: null,
    lease_until: null,
    delivered_at: null,
    last_error: null,
    ...overrides,
  }
  sqlite.prepare(`
    INSERT INTO notification_outbox
      (id, event_type, user_id, payload, correlation_id, state, created_at, attempts, next_attempt_at, lease_id, lease_until, delivered_at, last_error)
    VALUES
      (@id, @event_type, @user_id, @payload, @correlation_id, @state, @created_at, @attempts, @next_attempt_at, @lease_id, @lease_until, @delivered_at, @last_error)
  `).run(row)
  return row
}

function getRow(id: string): OutboxRow {
  return sqlite.prepare('SELECT * FROM notification_outbox WHERE id = ?').get(id) as OutboxRow
}

/** Poll a condition on a real wall clock, since the outbox runtime under
 * test schedules its own polling loop with real timers (not fake ones). */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 5_000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  if (!predicate()) {
    throw new Error(`waitFor: condition not met within ${timeoutMs}ms`)
  }
}

describe('startNotificationOutbox', () => {
  it('is a safe no-op when Glocke HMAC credentials are not configured', async () => {
    clearCredentials()

    let runtime: { stop: () => Promise<void> } | undefined
    expect(() => {
      runtime = startNotificationOutbox() as unknown as { stop: () => Promise<void> }
    }).not.toThrow()

    expect(runtime).toBeDefined()
    expect(typeof runtime?.stop).toBe('function')
    await expect(runtime?.stop()).resolves.not.toThrow()
  })

  it('delivers a pending row and marks it delivered on a 2xx response', async () => {
    configureCredentials()
    const row = seedRow()

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const runtime = startNotificationOutbox() as unknown as { stop: () => Promise<void> }
    try {
      await waitFor(() => getRow(row.id).state === 'delivered')

      const delivered = getRow(row.id)
      expect(delivered.state).toBe('delivered')
      expect(delivered.delivered_at).not.toBeNull()
      expect(delivered.lease_id).toBeNull()
      expect(delivered.lease_until).toBeNull()
      expect(fetchMock).toHaveBeenCalled()
    } finally {
      await runtime.stop()
    }
  })

  it('marks a row as permanently failed (not endlessly retried) on a non-retryable error response', async () => {
    configureCredentials()
    const row = seedRow()

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    const runtime = startNotificationOutbox() as unknown as { stop: () => Promise<void> }
    try {
      // Wait for the terminal marker (a recorded error), not merely
      // "state !== 'pending'" - the row passes through a transient
      // 'inflight' (claimed-but-not-yet-settled) state first, and racing
      // that intermediate state would make this test itself flaky.
      await waitFor(() => getRow(row.id).last_error !== null)

      const failed = getRow(row.id)
      expect(failed.state).not.toBe('pending')
      expect(failed.state).not.toBe('inflight')
      expect(failed.attempts).toBeGreaterThanOrEqual(1)
      expect(failed.last_error).not.toBeNull()
      expect(typeof failed.last_error).toBe('string')
      expect(fetchMock).toHaveBeenCalled()
    } finally {
      await runtime.stop()
    }
  })
})
