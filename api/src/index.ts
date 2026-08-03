import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { createCorsMiddleware } from '@zudar107/schloss-server-kit'
import { bodyLimit } from 'hono/body-limit'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './db/index.js'
import { usersRouter } from './features/users/router.js'
import { notesRouter } from './features/notes/router.js'
import { requireAuth, requireAdmin } from './middleware/auth.js'
import { openApiDocument } from './openapi.js'

// Resolved relative to this file so it works both in dev (src/index.ts,
// migrations at src/db/migrations) and in the compiled build
// (dist/index.js, migrations at dist/db/migrations) without a hardcoded
// path that only matches one of the two.
const __dirname = dirname(fileURLToPath(import.meta.url))

migrate(db, { migrationsFolder: join(__dirname, 'db/migrations') })

const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5176')
  .split(',').map((o) => o.trim())

const app = new Hono()

app.use('*', bodyLimit({
  maxSize: 1 * 1024 * 1024,
  onError: (c) => c.json({ error: 'Request body too large' }, 413),
}))
app.use('*', logger())
app.use('*', createCorsMiddleware({ allowedOrigins: ALLOWED_ORIGINS }))

app.get('/health', (c) => c.json({ status: 'ok', service: 'Zettel' }))

// Reached from zettel/web's own /docs page as /api/openapi.json (the web
// container's Caddyfile already proxies /api/* here with the prefix
// stripped) - no new reverse-proxy rule needed.
app.get('/openapi.json', requireAuth, requireAdmin, (c) => c.json(openApiDocument))

app.route('/users', usersRouter)
app.route('/notes', notesRouter)

const PORT = Number(process.env['PORT'] ?? 3003)
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[Zettel API] Running on http://localhost:${PORT}`)
})

export { app }
