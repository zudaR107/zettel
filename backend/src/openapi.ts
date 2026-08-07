import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { noteSchema } from './features/notes/router.js'

// Purely additive/descriptive: this file only describes the API surface
// already implemented under src/features/*/router.ts. It has zero
// effect on runtime request validation - deleting it wouldn't change
// any endpoint's behavior.

const registry = new OpenAPIRegistry()

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
})

const BEARER = [{ bearerAuth: [] }]

const errorResponseSchema = z.object({ error: z.string() })

const noteResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  content: z.string(),
  pinned: z.boolean(),
  archived: z.boolean(),
  tags: z.array(z.string()),
  createdAt: z.string().meta({ format: 'date-time' }),
  updatedAt: z.string().meta({ format: 'date-time' }),
})

// Mirrors notes/router.ts's noteUpdateSchema (not literally noteSchema.partial() -
// see that file for why: .default() on noteSchema's fields would otherwise make a
// partial PUT silently reset absent fields). Kept here rather than imported so this
// file's only coupling to the real schema stays the same shape as its noteSchema import.
const noteUpdateSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().optional(),
  pinned: z.boolean().optional(),
  tags: z.array(z.string().max(50)).max(30).optional(),
})

// ── Users ────────────────────────────────────────────────────────────────
// weekStart/dateFormat/timezone are read straight off the caller's verified
// JWT (sourced from Schlüssel's own account settings) - Zettel never stores
// or lets you edit these locally.
const meResponseSchema = z.object({
  id: z.string(), email: z.string(), name: z.string(),
  weekStart: z.enum(['monday', 'sunday']).nullable().meta({
    enum: ['monday', 'sunday'],
    description: 'Schlüssel JWT claim; null when the preference is unset or absent from the token.',
  }),
  dateFormat: z.enum(['dmy', 'mdy', 'ymd']).nullable().meta({
    enum: ['dmy', 'mdy', 'ymd'],
    description: 'Schlüssel JWT claim; null when the preference is unset or absent from the token.',
  }),
  timezone: z.string().nullable().meta({
    description: 'Schlüssel JWT claim containing a valid IANA time-zone identifier, or null when unset or absent.',
  }),
})

registry.registerPath({
  method: 'get', path: '/users/me', tags: ['users'], summary: "Get the current user's profile",
  description: 'Regional preferences are read-only values from the verified Schlüssel JWT; Zettel does not store or edit them. Missing preference claims are returned as null, while malformed claims make the token invalid.',
  security: BEARER,
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: meResponseSchema } },
    },
    401: {
      description: 'Missing, invalid, expired, or malformed bearer token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
})

// Zettel's own data only - see scope: 'zettel-account-only' in the response.
// Not a platform-wide export (Schlüssel has its own separate /auth/export
// for that). Includes archived notes, unlike the default notes listing.
const exportResponseSchema = z.object({
  exportedAt: z.string(),
  scope: z.literal('zettel-account-only'),
  notes: z.array(z.object({
    id: noteResponseSchema.shape.id,
    title: noteResponseSchema.shape.title,
    content: noteResponseSchema.shape.content,
    pinned: noteResponseSchema.shape.pinned,
    archived: noteResponseSchema.shape.archived,
    tags: noteResponseSchema.shape.tags,
    createdAt: noteResponseSchema.shape.createdAt,
    updatedAt: noteResponseSchema.shape.updatedAt,
  })),
})

registry.registerPath({
  method: 'get', path: '/users/export', tags: ['users'], summary: "Export the caller's notes and tags",
  description: "Exports only the caller's Zettel data, not their Schlüssel account or data from other Hof apps. The notes array includes active and archived notes with their tags.",
  security: BEARER,
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: exportResponseSchema } },
    },
    401: {
      description: 'Missing, invalid, expired, or malformed bearer token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
})

// ── Tags ─────────────────────────────────────────────────────────────────
const tagResponseSchema = z.object({ id: z.string(), name: z.string() })

registry.registerPath({
  method: 'get', path: '/tags', tags: ['tags'], summary: "List the caller's tags",
  description: 'Lists tags attached to at least one active note, sorted by name. The UI presents this same list as virtual folders; folders are not a separate API resource.',
  security: BEARER,
  responses: {
    200: {
      description: 'In-use tags from active notes',
      content: { 'application/json': { schema: z.array(tagResponseSchema) } },
    },
  },
})

// ── Notes ────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/notes', tags: ['notes'], summary: "List the caller's notes",
  description: 'Filters are combined. Results are ordered by pinned status and then most recently updated.',
  security: BEARER,
  request: { query: z.object({
    q: z.string().optional().meta({
      description: 'Non-indexed SQL LIKE substring search across note titles and content; this is not full-text search.',
    }),
    tag: z.string().optional().meta({
      description: 'Exact tag-name filter. Sidebar folders submit the corresponding tag name here.',
    }),
    archived: z.enum(['true', 'false']).optional().meta({
      description: 'true lists archived notes; false or omission lists active notes.',
    }),
  }) },
  responses: {
    200: {
      description: 'Filtered caller-owned notes',
      content: { 'application/json': { schema: z.array(noteResponseSchema) } },
    },
  },
})

registry.registerPath({
  method: 'post', path: '/notes', tags: ['notes'], summary: 'Create a note',
  security: BEARER,
  request: { body: { content: { 'application/json': { schema: noteSchema } } } },
  responses: { 201: { description: 'Created' } },
})

registry.registerPath({
  method: 'get', path: '/notes/{id}', tags: ['notes'], summary: 'Get a note',
  security: BEARER, request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK' } },
})

registry.registerPath({
  method: 'get', path: '/notes/{id}/backlinks', tags: ['notes'], summary: 'List notes that link to this note',
  security: BEARER, request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK' } },
})

registry.registerPath({
  method: 'put', path: '/notes/{id}', tags: ['notes'], summary: 'Update a note',
  security: BEARER,
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: noteUpdateSchema } } },
  },
  responses: { 200: { description: 'OK' } },
})

registry.registerPath({
  method: 'delete', path: '/notes/{id}', tags: ['notes'], summary: 'Archive a note (soft delete)',
  security: BEARER, request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Archived',
      content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
    },
    404: {
      description: 'No note with this id belongs to the caller',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
})

registry.registerPath({
  method: 'post', path: '/notes/{id}/restore', tags: ['notes'], summary: 'Restore an archived note',
  description: 'Moves a caller-owned archived note back to the active list and updates its updatedAt timestamp.',
  security: BEARER, request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Restored note',
      content: { 'application/json': { schema: noteResponseSchema } },
    },
    404: {
      description: 'The note does not exist, does not belong to the caller, or is not archived',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing, invalid, expired, or malformed bearer token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
})

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: { title: 'Zettel API', version: '0.1.0' },
  servers: [{ url: '/' }],
})
