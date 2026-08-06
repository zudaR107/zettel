import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { usersRouter } from '../../features/users/router.js'
import { notesRouter } from '../../features/notes/router.js'
import { tagsRouter } from '../../features/tags/router.js'
import { requireAuth, requireAdmin } from '../../middleware/auth.js'
import { openApiDocument } from '../../openapi.js'

/**
 * Build a minimal Hono app wired up with the real users router plus the
 * inline /health and /openapi.json routes that index.ts itself defines.
 * Those two are reconstructed here rather than importing index.ts directly,
 * since index.ts eagerly runs drizzle's migrate() against the db module at
 * import time (which would blow up against helpers/db.ts's already-migrated
 * in-memory db) and, as the real entrypoint, also starts an HTTP listener
 * as a side effect - mirroring tafel/kuvert's own createTestApp() shape.
 *
 * The db and auth modules are expected to have been mocked by the calling
 * test file (via vi.mock('../db/index.js', ...) and
 * vi.mock('../middleware/auth.js', ...)) before this function is called.
 */
export function createTestApp() {
  const app = new Hono()
  // Mirrors index.ts's real middleware stack, not just the routers - so
  // this exact behavior (body-size limiting) is exercised in tests too.
  app.use(
    '*',
    bodyLimit({
      maxSize: 1 * 1024 * 1024,
      onError: (c) => c.json({ error: 'Request body too large' }, 413),
    }),
  )
  app.get('/health', (c) => c.json({ status: 'ok', service: 'Zettel' }))
  app.get('/openapi.json', requireAuth, requireAdmin, (c) => c.json(openApiDocument))
  app.route('/users', usersRouter)
  app.route('/notes', notesRouter)
  app.route('/tags', tagsRouter)
  return app
}
