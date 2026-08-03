import { createMiddleware } from 'hono/factory'
import { sqlite } from './db.js'

interface MockUser {
  id: string
  email: string
  name: string
  role: 'user' | 'admin'
}

/**
 * Mock auth middleware for tests.
 * "Bearer test-token"   → user-1 (non-admin)
 * "Bearer user2-token"  → user-2 (non-admin)
 * "Bearer admin-token"  → admin-1 (admin, for requireAdmin tests)
 * anything else         → 401
 */
const TOKENS: Record<string, MockUser> = {
  'test-token': { id: 'user-1', email: 'test@example.com', name: 'Test User', role: 'user' },
  'user2-token': { id: 'user-2', email: 'test2@example.com', name: 'Test User 2', role: 'user' },
  'admin-token': { id: 'admin-1', email: 'admin@example.com', name: 'Admin User', role: 'admin' },
}

export const requireAuth = createMiddleware(async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = auth.slice(7)
  const user = TOKENS[token]
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Mirror the real middleware's auto-provisioning: on first successful
  // auth for this user id, create the `users` row from the JWT claims; if
  // a row already exists, leave it untouched (no re-create, no overwrite).
  const existing = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(user.id)
  if (!existing) {
    sqlite
      .prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .run(user.id, user.email, user.name, Date.now())
  }

  c.set('user', user)
  await next()
})

export const requireAdmin = createMiddleware(async (c, next) => {
  const user = c.get('user') as MockUser | undefined
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
})
