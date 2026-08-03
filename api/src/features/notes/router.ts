import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, or, like, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.js'
import { notes } from '../../db/schema.js'
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
// validated output and never overwrites the existing column.
const noteUpdateSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().optional(),
  pinned: z.boolean().optional(),
})

const listQuerySchema = z.object({
  q: z.string().optional(),
})

router.get('/', zValidator('query', listQuerySchema), async (c) => {
  const user = c.get('user')
  const { q } = c.req.valid('query')

  const conditions = [eq(notes.userId, user.id), eq(notes.archived, false)]
  if (q) conditions.push(or(like(notes.title, `%${q}%`), like(notes.content, `%${q}%`))!)

  return c.json(
    await db.select().from(notes).where(and(...conditions))
      .orderBy(desc(notes.pinned), desc(notes.updatedAt)),
  )
})

router.post('/', zValidator('json', noteSchema), async (c) => {
  const user = c.get('user')
  const data = c.req.valid('json')

  const now = new Date()
  const note = { id: createId(), userId: user.id, ...data, archived: false, createdAt: now, updatedAt: now }
  await db.insert(notes).values(note)
  return c.json(note, 201)
})

router.get('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const note = await db.select().from(notes).where(and(eq(notes.id, id), eq(notes.userId, user.id))).get()
  if (!note) return c.json({ error: 'Not found' }, 404)
  return c.json(note)
})

router.put('/:id', zValidator('json', noteUpdateSchema), async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const data = c.req.valid('json')

  const existing = await db.select().from(notes).where(and(eq(notes.id, id), eq(notes.userId, user.id))).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const updatedAt = new Date()
  await db.update(notes).set({ ...data, updatedAt }).where(eq(notes.id, id))
  return c.json({ ...existing, ...data, updatedAt })
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

export { router as notesRouter }
