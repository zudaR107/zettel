import { Hono } from 'hono'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { users, notes, tags, noteTags } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

// requireAuth auto-provisions the local user row on every authenticated
// request, so by the time this handler runs the row is guaranteed to
// exist - no "not found" branch needed.
router.get('/me', async (c) => {
  const user = c.get('user')
  const row = await db.select().from(users).where(eq(users.id, user.id)).get()
  // weekStart/dateFormat/timezone come straight off the already-verified
  // JWT (schlussel embeds them at sign time), not this row - Zettel never
  // stores its own copy of a Schlüssel-owned preference.
  return c.json({
    id: row!.id, email: row!.email, name: row!.name,
    weekStart: user.weekStart, dateFormat: user.dateFormat, timezone: user.timezone,
  })
})

// Zettel's own data only (Schlüssel's own /auth/export is a separate,
// service-scoped export of its own account data - this is NOT a
// platform-wide export, and says so explicitly via `scope`). Includes
// archived notes, unlike the default notes listing - an export is meant
// to be complete, not just "what the active notes list currently shows."
router.get('/export', async (c) => {
  const user = c.get('user')

  const noteRows = await db.select().from(notes).where(eq(notes.userId, user.id))
  const noteIds = noteRows.map((n) => n.id)
  const tagRows = noteIds.length > 0
    ? await db.select({ noteId: noteTags.noteId, name: tags.name })
        .from(noteTags)
        .innerJoin(tags, eq(tags.id, noteTags.tagId))
        .where(inArray(noteTags.noteId, noteIds))
    : []
  const tagsByNote = new Map<string, string[]>()
  for (const r of tagRows) tagsByNote.set(r.noteId, [...(tagsByNote.get(r.noteId) ?? []), r.name])

  return c.json({
    exportedAt: new Date().toISOString(),
    scope: 'zettel-account-only',
    notes: noteRows.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      pinned: n.pinned,
      archived: n.archived,
      tags: (tagsByNote.get(n.id) ?? []).sort(),
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
  })
})

export { router as usersRouter }
