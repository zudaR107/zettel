import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, or, ne, like, desc, inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.js'
import { notes, tags, noteTags, type Note } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

export const noteSchema = z.object({
  title: z.string().max(200).default(''),
  content: z.string().default(''),
  pinned: z.boolean().default(false),
})

// Deliberately NOT noteSchema.partial() - .default() fires whenever a key
// is *absent* from the input, regardless of .optional()/.partial(), so a
// partial PUT that only means to change e.g. `pinned` would otherwise
// silently reset title/content to '' on every single update. This schema's
// fields have no defaults at all, so an absent key stays absent in the
// validated output and never overwrites the existing column. `tags`
// follows the same rule: an absent key leaves existing tags untouched,
// while `tags: []` explicitly clears them.
const noteUpdateSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().optional(),
  pinned: z.boolean().optional(),
  tags: z.array(z.string().max(50)).max(30).optional(),
})

const listQuerySchema = z.object({
  q: z.string().optional(),
  tag: z.string().optional(),
  archived: z.enum(['true', 'false']).optional(),
})

// Attaches each note's current tag names (sorted) - a single batched
// query for the whole page rather than one query per note.
async function attachTags(noteRows: Note[]): Promise<(Note & { tags: string[] })[]> {
  if (noteRows.length === 0) return []

  const rows = await db.select({ noteId: noteTags.noteId, name: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(tags.id, noteTags.tagId))
    .where(inArray(noteTags.noteId, noteRows.map((n) => n.id)))

  const byNote = new Map<string, string[]>()
  for (const r of rows) byNote.set(r.noteId, [...(byNote.get(r.noteId) ?? []), r.name])

  return noteRows.map((n) => ({ ...n, tags: (byNote.get(n.id) ?? []).sort() }))
}

// Creates any tag name not already registered for this user, then
// replaces the note's tag set wholesale (delete-all, reinsert) - simpler
// than diffing, and cheap at personal-note-taking scale. An orphaned tag
// row left behind by removing the last note referencing it is harmless:
// GET /tags and this same query both join through note_tags, so an
// unused name just never appears anywhere again.
//
// Matching against existing tags is case-insensitive ("Work" and "work"
// resolve to the same tag, keeping whichever casing was registered
// first) - the `tags_user_id_name_unique` index itself is still a plain
// case-sensitive SQL constraint (a personal-scale tradeoff, same as the
// LIKE-scan backlinks above: two concurrent requests racing different
// casings for a brand new name could in theory both pass this
// in-app check, which the index would then reject on the second insert -
// not worth guarding against for a single-user note app).
async function syncNoteTags(userId: string, noteId: string, tagNames: string[]) {
  const trimmed = tagNames.map((t) => t.trim()).filter(Boolean)
  const seen = new Set<string>()
  const names: string[] = []
  for (const name of trimmed) {
    const key = name.toLowerCase()
    if (!seen.has(key)) { seen.add(key); names.push(name) }
  }

  const existingTags = await db.select().from(tags).where(eq(tags.userId, userId))
  const byLowerName = new Map(existingTags.map((t) => [t.name.toLowerCase(), t]))

  const tagIds: string[] = []
  for (const name of names) {
    let tag = byLowerName.get(name.toLowerCase())
    if (!tag) {
      tag = { id: createId(), userId, name, createdAt: new Date() }
      await db.insert(tags).values(tag)
      byLowerName.set(name.toLowerCase(), tag)
    }
    tagIds.push(tag.id)
  }

  await db.delete(noteTags).where(eq(noteTags.noteId, noteId))
  if (tagIds.length > 0) await db.insert(noteTags).values(tagIds.map((tagId) => ({ noteId, tagId })))
}

router.get('/', zValidator('query', listQuerySchema), async (c) => {
  const user = c.get('user')
  const { q, tag, archived } = c.req.valid('query')

  const conditions = [eq(notes.userId, user.id), eq(notes.archived, archived === 'true')]
  if (q) conditions.push(or(like(notes.title, `%${q}%`), like(notes.content, `%${q}%`))!)

  let noteRows: Note[]
  if (tag) {
    noteRows = await db.select({ id: notes.id, userId: notes.userId, title: notes.title, content: notes.content, pinned: notes.pinned, archived: notes.archived, createdAt: notes.createdAt, updatedAt: notes.updatedAt })
      .from(notes)
      .innerJoin(noteTags, eq(noteTags.noteId, notes.id))
      .innerJoin(tags, and(eq(tags.id, noteTags.tagId), eq(tags.name, tag)))
      .where(and(...conditions))
      .orderBy(desc(notes.pinned), desc(notes.updatedAt))
  } else {
    noteRows = await db.select().from(notes).where(and(...conditions))
      .orderBy(desc(notes.pinned), desc(notes.updatedAt))
  }

  return c.json(await attachTags(noteRows))
})

router.post('/', zValidator('json', noteSchema), async (c) => {
  const user = c.get('user')
  const data = c.req.valid('json')

  const now = new Date()
  const note = { id: createId(), userId: user.id, ...data, archived: false, createdAt: now, updatedAt: now }
  await db.insert(notes).values(note)
  return c.json({ ...note, tags: [] }, 201)
})

router.get('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const note = await db.select().from(notes).where(and(eq(notes.id, id), eq(notes.userId, user.id))).get()
  if (!note) return c.json({ error: 'Not found' }, 404)
  const [withTags] = await attachTags([note])
  return c.json(withTags)
})

// Other notes that currently link to this one via `[[This Note's Title]]`
// in their content. Computed live via a LIKE scan against the title,
// rather than a maintained links table - fine at personal-note-taking
// scale and avoids keeping a derived index in sync on every save.
router.get('/:id/backlinks', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const note = await db.select().from(notes).where(and(eq(notes.id, id), eq(notes.userId, user.id))).get()
  if (!note) return c.json({ error: 'Not found' }, 404)
  // An empty title would otherwise LIKE-match every note containing a
  // literal "[[]]", which is never a meaningful backlink.
  if (!note.title) return c.json([])

  const rows = await db.select({ id: notes.id, title: notes.title }).from(notes).where(and(
    eq(notes.userId, user.id),
    eq(notes.archived, false),
    ne(notes.id, id),
    like(notes.content, `%[[${note.title}]]%`),
  ))
  return c.json(rows)
})

router.put('/:id', zValidator('json', noteUpdateSchema), async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const { tags: tagNames, ...data } = c.req.valid('json')

  const existing = await db.select().from(notes).where(and(eq(notes.id, id), eq(notes.userId, user.id))).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const updatedAt = new Date()
  await db.update(notes).set({ ...data, updatedAt }).where(eq(notes.id, id))
  if (tagNames !== undefined) await syncNoteTags(user.id, id, tagNames)

  const [withTags] = await attachTags([{ ...existing, ...data, updatedAt }])
  return c.json(withTags)
})

// Archives (soft delete), matching the platform's established convention
// (kuvert's accounts/tafel's projects do the same) - never hard-deletes.
router.delete('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const existing = await db.select().from(notes).where(and(eq(notes.id, id), eq(notes.userId, user.id))).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(notes).set({ archived: true }).where(eq(notes.id, id))
  return c.json({ ok: true })
})

router.post('/:id/restore', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const ownership = and(eq(notes.id, id), eq(notes.userId, user.id), eq(notes.archived, true))
  const existing = await db.select().from(notes).where(ownership).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const updatedAt = new Date()
  await db.update(notes).set({ archived: false, updatedAt }).where(ownership)
  const [withTags] = await attachTags([{ ...existing, archived: false, updatedAt }])
  return c.json(withTags)
})

export { router as notesRouter }
