import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { tags, noteTags, notes } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

// Only tags actually attached to a non-archived note - a name can exist
// in the `tags` table (nothing prunes it) without being "in use" anymore,
// and archived notes are already hidden everywhere else in the app.
router.get('/', async (c) => {
  const user = c.get('user')

  const rows = await db.selectDistinct({ id: tags.id, name: tags.name })
    .from(tags)
    .innerJoin(noteTags, eq(noteTags.tagId, tags.id))
    .innerJoin(notes, eq(notes.id, noteTags.noteId))
    .where(and(eq(tags.userId, user.id), eq(notes.archived, false)))
    .orderBy(tags.name)

  return c.json(rows)
})

export { router as tagsRouter }
