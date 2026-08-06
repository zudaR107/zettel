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
registry.registerPath({
  method: 'get', path: '/users/me', tags: ['users'], summary: "Get the current user's profile",
  security: BEARER, responses: { 200: { description: 'OK' } },
})

// ── Tags ─────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/tags', tags: ['tags'], summary: "List the caller's tags",
  security: BEARER, responses: { 200: { description: 'OK' } },
})

// ── Notes ────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/notes', tags: ['notes'], summary: "List the caller's notes",
  security: BEARER,
  request: { query: z.object({ q: z.string().optional(), tag: z.string().optional() }) },
  responses: { 200: { description: 'OK' } },
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
  responses: { 200: { description: 'OK' } },
})

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: { title: 'Zettel API', version: '0.1.0' },
  servers: [{ url: '/' }],
})
