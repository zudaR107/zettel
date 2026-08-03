import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readdirSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as schema from '../../db/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const sqlite = new Database(':memory:')
sqlite.pragma('foreign_keys = ON')

// Run every migration file in order (not just the first one) - the
// numeric filename prefix drizzle-kit generates already sorts correctly.
const migrationsDir = resolve(__dirname, '../../db/migrations')
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
for (const file of migrationFiles) {
  const migrationSql = readFileSync(resolve(migrationsDir, file), 'utf-8')
  for (const stmt of migrationSql.split('--> statement-breakpoint')) {
    const s = stmt.trim()
    if (s) sqlite.exec(s)
  }
}

export const db = drizzle(sqlite, { schema })

/**
 * Unlike tafel/kuvert's helpers/db.ts, zettel has no permanently pre-seeded
 * test users: the whole point of this suite's users.test.ts is to exercise
 * the auto-provisioning behavior described in the spec ("first time we see
 * a user id" vs "row already exists"), so each test needs to be able to
 * start from a genuinely empty users table. cleanDb() therefore wipes
 * `users` completely between tests instead of preserving it.
 */
export function cleanDb() {
  sqlite.exec('DELETE FROM users')
}
