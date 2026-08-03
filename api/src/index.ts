import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'

const app = new Hono()
app.use('*', logger())

const PORT = Number(process.env['PORT'] ?? 3003)
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[Zettel API] Running on http://localhost:${PORT}`)
})

export { app }
