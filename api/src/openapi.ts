import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'

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

// ── Users ────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/users/me', tags: ['users'], summary: "Get the current user's profile",
  security: BEARER, responses: { 200: { description: 'OK' } },
})

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: { title: 'Zettel API', version: '0.1.0' },
  servers: [{ url: '/' }],
})
