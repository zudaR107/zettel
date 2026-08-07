import { createAuthMiddleware, createExportAuthMiddleware } from '@zudar107/schloss-server-kit'
import type { AuthUser } from '@zudar107/schloss-server-kit'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'

export type { AuthUser }

const JWKS_URL = process.env['SCHLUSSEL_JWKS_URL'] ?? 'http://localhost:4000/.well-known/jwks.json'
const ISSUER = process.env['JWT_ISSUER'] ?? 'schlussel'

export const { requireAuth, requireAdmin } = createAuthMiddleware({
  jwksUrl: JWKS_URL,
  issuer: ISSUER,
  // Auto-provision a local user row on first sight - Zettel stores only
  // the user id from the JWT, no passwords here.
  onUserSeen: async (user) => {
    const existing = await db.select().from(users).where(eq(users.id, user.id)).get()
    if (!existing) {
      await db.insert(users).values({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: new Date(),
      })
    }
  },
})

// Unlike ordinary routes, the standardized export endpoint accepts either a
// normal access token or a delegation scoped exactly to Zettel exports.
export const requireExportAuth = createExportAuthMiddleware({
  jwksUrl: JWKS_URL,
  issuer: ISSUER,
  service: 'zettel',
})
