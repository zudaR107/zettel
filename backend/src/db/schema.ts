import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
