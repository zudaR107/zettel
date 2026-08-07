import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core'

// Every timestamp column here uses `mode: 'timestamp_ms'`, not the more
// common `mode: 'timestamp'` - the latter stores epoch *seconds*
// (Math.floor(ms / 1000)) and truncates sub-second precision on every
// round-trip through the DB. Both modes map to the same SQL `integer`
// column type - this is a pure application-level interpretation choice.

// ── Users (mirrored from Schlüssel via JWT) ───────────────────────
// We store only the user id from the JWT — no passwords here.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export type User = typeof users.$inferSelect

// ── Notes ────────────────────────────────────────────────────────
export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default(''),
  content: text('content').notNull().default(''),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export type Note = typeof notes.$inferSelect

// ── Tags ─────────────────────────────────────────────────────────
// A permanent per-user registry of tag names - `note_tags` below is the
// actual "in use" relation. A name can outlive every note that used it
// (nothing prunes an orphaned row here); `GET /tags` and note-tag lookups
// both join through `note_tags`/`notes`, so an orphan just never appears
// anywhere rather than needing active cleanup.
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('tags_user_id_name_unique').on(table.userId, table.name),
])

export type Tag = typeof tags.$inferSelect

export const noteTags = sqliteTable('note_tags', {
  noteId: text('note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.noteId, table.tagId] }),
])

// ── Notification outbox ─────────────────────────────────────────────
// Transactional-outbox row for the shared generic dispatcher
// (@zudar107/schloss-server-kit's createNotificationOutboxRuntime,
// wired up in notifications/outbox.ts). Inserted in the SAME
// db.transaction() as the note update it reports (see
// features/notes/router.ts) - never a separate write, so a failure to
// record the event rolls back the note change with it rather than
// silently losing the event. No dedupe-key column here (unlike
// tafel's) - zettel's dedup is old-vs-new content diffing done in
// application code before the insert, not a DB constraint.
export const notificationOutbox = sqliteTable('notification_outbox', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  userId: text('user_id').notNull(),
  payload: text('payload').notNull(),
  correlationId: text('correlation_id').notNull(),
  state: text('state').notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at'),
  leaseId: text('lease_id'),
  leaseUntil: integer('lease_until'),
  deliveredAt: integer('delivered_at'),
  lastError: text('last_error'),
}, (table) => [
  index('notification_outbox_dispatch_idx').on(table.state, table.nextAttemptAt),
])

export type NotificationOutboxRow = typeof notificationOutbox.$inferSelect
