import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import {
  exportEnvelopeSchema,
  type ExportAuthEnv,
} from '@zudar107/schloss-server-kit'
import { db } from '../../db/index.js'
import { notes, noteTags, tags } from '../../db/schema.js'
import { requireExportAuth } from '../../middleware/auth.js'

interface ExportNote {
  id: string
  title: string
  content: string
  pinned: boolean
  archived: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

interface ExportTag {
  id: string
  name: string
  createdAt: string
}

export interface ZettelExportData {
  notes: ExportNote[]
  tags: ExportTag[]
}

// better-sqlite3 and its Drizzle driver are synchronous. Keeping every query
// inside this callback guarantees one SQLite read snapshot with no async gap.
export function exportDataForUser(userId: string): ZettelExportData {
  return db.transaction((tx) => {
    const noteRows = tx.select().from(notes).where(eq(notes.userId, userId)).all()
    const tagRows = tx.select().from(tags).where(eq(tags.userId, userId)).all()
    const relationRows = tx.select({ noteId: noteTags.noteId, name: tags.name })
      .from(noteTags)
      .innerJoin(notes, eq(notes.id, noteTags.noteId))
      .innerJoin(tags, eq(tags.id, noteTags.tagId))
      .where(and(eq(notes.userId, userId), eq(tags.userId, userId)))
      .all()

    const tagsByNote = new Map<string, string[]>()
    for (const row of relationRows) {
      tagsByNote.set(row.noteId, [...(tagsByNote.get(row.noteId) ?? []), row.name])
    }

    return {
      notes: noteRows.map((note) => ({
        id: note.id,
        title: note.title,
        content: note.content,
        pinned: note.pinned,
        archived: note.archived,
        tags: (tagsByNote.get(note.id) ?? []).sort(),
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      })),
      tags: tagRows.map((tag) => ({
        id: tag.id,
        name: tag.name,
        createdAt: tag.createdAt.toISOString(),
      })),
    }
  })
}

const router = new Hono<ExportAuthEnv>()

router.get('/me', requireExportAuth, (c) => {
  const principal = c.get('exportPrincipal')
  const data = exportDataForUser(principal.sub)

  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')
  c.header('X-Content-Type-Options', 'nosniff')
  return c.json(exportEnvelopeSchema.parse({
    version: '1',
    service: 'zettel',
    exportedAt: new Date().toISOString(),
    data,
  }))
})

export { router as exportsRouter }
