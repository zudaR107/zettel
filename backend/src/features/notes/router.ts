import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, or, ne, like, desc, inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { randomUUID } from 'node:crypto'
import { db } from '../../db/index.js'
import { notes, tags, noteTags, notificationOutbox, type Note } from '../../db/schema.js'
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
// Synchronous, tx-bound version - called from inside the PUT /:id
// db.transaction() below alongside the note update and any backlink
// event inserts, so all three either commit or roll back together
// (better-sqlite3 transaction callbacks must be synchronous, no await
// inside).
function syncNoteTagsTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  noteId: string,
  tagNames: string[],
): void {
  const trimmed = tagNames.map((t) => t.trim()).filter(Boolean)
  const seen = new Set<string>()
  const names: string[] = []
  for (const name of trimmed) {
    const key = name.toLowerCase()
    if (!seen.has(key)) { seen.add(key); names.push(name) }
  }

  const existingTags = tx.select().from(tags).where(eq(tags.userId, userId)).all()
  const byLowerName = new Map(existingTags.map((t) => [t.name.toLowerCase(), t]))

  const tagIds: string[] = []
  for (const name of names) {
    let tag = byLowerName.get(name.toLowerCase())
    if (!tag) {
      tag = { id: createId(), userId, name, createdAt: new Date() }
      tx.insert(tags).values(tag).run()
      byLowerName.set(name.toLowerCase(), tag)
    }
    tagIds.push(tag.id)
  }

  tx.delete(noteTags).where(eq(noteTags.noteId, noteId)).run()
  if (tagIds.length > 0) tx.insert(noteTags).values(tagIds.map((tagId) => ({ noteId, tagId }))).run()
}

// Titles referenced via `[[Title]]` in raw note content, lowercased and
// deduplicated - empty brackets (`[[]]`) are excluded since they never
// name a real target.
function extractWikiLinkTitles(content: string): Set<string> {
  const titles = new Set<string>()
  for (const match of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const title = (match[1] ?? '').trim()
    if (title) titles.add(title.toLowerCase())
  }
  return titles
}

// Titles newly present in `newContent` but absent from `oldContent`,
// resolved against this user's own active (non-archived, non-self)
// notes - matches the frontend's `resolveWikiLinks` resolution rules
// (case-insensitive title match, unresolved/self/cross-owner/archived
// targets silently ignored). A link that was already there before this
// save, or that never resolves to a real note, never queues an event.
async function resolveIntroducedBacklinkTargets(
  userId: string,
  selfId: string,
  oldContent: string,
  newContent: string,
): Promise<{ id: string; title: string }[]> {
  const oldTitles = extractWikiLinkTitles(oldContent)
  const newTitles = extractWikiLinkTitles(newContent)
  const introduced = [...newTitles].filter((title) => !oldTitles.has(title))
  if (introduced.length === 0) return []

  const candidates = await db.select().from(notes).where(and(
    eq(notes.userId, userId),
    eq(notes.archived, false),
    ne(notes.id, selfId),
  ))
  const byLowerTitle = new Map(
    candidates.filter((note) => note.title).map((note) => [note.title.toLowerCase(), note]),
  )

  const resolved: { id: string; title: string }[] = []
  for (const title of introduced) {
    const note = byLowerTitle.get(title)
    if (note) resolved.push({ id: note.id, title: note.title })
  }
  return resolved
}

// Inserted in the same db.transaction() as the note update/tag sync it
// reports (see PUT /:id below) - if this insert fails, the whole
// transaction (including the note change itself) rolls back with it,
// matching the pattern established in kuvert's goal-completion events.
function insertBacklinkEvent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  sourceTitle: string,
  targetTitle: string,
): void {
  const id = randomUUID()
  const now = Date.now()
  tx.insert(notificationOutbox).values({
    id,
    eventType: 'zettel.note.backlink_added.v1',
    userId,
    payload: JSON.stringify({ recipientId: userId, sourceTitle, targetTitle }),
    correlationId: id,
    state: 'pending',
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
    leaseId: null,
    leaseUntil: null,
    deliveredAt: null,
    lastError: null,
  }).run()
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

  // Only a title/content/pinned change counts as "editing the note" for
  // updatedAt purposes (which drives sort order and "last edited"
  // display) - a tags-only PUT still applies (see syncNoteTagsTx below),
  // it just doesn't touch this note's own updatedAt column.
  const hasDomainChange = Object.keys(data).length > 0
  const updatedAt = hasDomainChange ? new Date() : existing.updatedAt
  const newTitle = data.title ?? existing.title
  const newContent = data.content ?? existing.content
  const introducedTargets = await resolveIntroducedBacklinkTargets(user.id, id, existing.content, newContent)

  try {
    db.transaction((tx) => {
      tx.update(notes).set({ ...data, updatedAt }).where(eq(notes.id, id)).run()
      if (tagNames !== undefined) syncNoteTagsTx(tx, user.id, id, tagNames)
      for (const target of introducedTargets) {
        insertBacklinkEvent(tx, user.id, newTitle, target.title)
      }
    })
  } catch {
    return c.json({ error: 'Failed to update note' }, 500)
  }

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
