import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/index.js', () => ({ db: {} }))
vi.mock('../middleware/auth.js', () => ({ requireAuth: vi.fn() }))

import { openApiDocument } from '../openapi.js'

describe('OpenAPI operations', () => {
  it('documents the archived notes query as a true/false enum', () => {
    expect(openApiDocument).toMatchObject({
      paths: {
        '/notes': {
          get: {
            parameters: expect.arrayContaining([
              expect.objectContaining({
                name: 'archived',
                in: 'query',
                schema: expect.objectContaining({ enum: ['true', 'false'] }),
              }),
            ]),
          },
        },
      },
    })
  })

  it('documents the restore operation and its note id path parameter', () => {
    expect(openApiDocument).toMatchObject({
      paths: {
        '/notes/{id}/restore': {
          post: {
            parameters: expect.arrayContaining([
              expect.objectContaining({ name: 'id', in: 'path', required: true }),
            ]),
            responses: {
              200: expect.any(Object),
              404: expect.any(Object),
            },
          },
        },
      },
    })
  })

  it('documents the Zettel export operation and response fields', () => {
    expect(openApiDocument).toMatchObject({
      paths: {
        '/users/export': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': {
                    schema: {
                      properties: {
                        exportedAt: expect.any(Object),
                        scope: expect.objectContaining({ enum: ['zettel-account-only'] }),
                        notes: expect.objectContaining({ type: 'array' }),
                      },
                      additionalProperties: false,
                    },
                  },
                },
                headers: {
                  'Cache-Control': { schema: { type: 'string', enum: ['no-store, private'] } },
                  Pragma: { schema: { type: 'string', enum: ['no-cache'] } },
                  'X-Content-Type-Options': { schema: { type: 'string', enum: ['nosniff'] } },
                },
              },
            },
          },
        },
      },
    })

    const response = openApiDocument.paths?.['/users/export']?.get?.responses?.[200] as {
      content?: { 'application/json'?: { schema?: { properties?: Record<string, unknown> } } }
    }
    expect(Object.keys(response.content?.['application/json']?.schema?.properties ?? {}).sort())
      .toEqual(['exportedAt', 'notes', 'scope'])
  })

  it('documents the standardized GET /exports/me envelope and authentication errors', () => {
    expect(openApiDocument).toMatchObject({
      paths: {
        '/exports/me': {
          get: {
            security: [
              { bearerAuth: [] },
              { exportDelegationAuth: [] },
            ],
            responses: {
              200: {
                headers: {
                  'Cache-Control': { schema: { type: 'string', enum: ['no-store, private'] } },
                  Pragma: { schema: { type: 'string', enum: ['no-cache'] } },
                  'X-Content-Type-Options': { schema: { type: 'string', enum: ['nosniff'] } },
                },
                content: {
                  'application/json': {
                    schema: {
                      additionalProperties: false,
                      required: ['version', 'service', 'exportedAt', 'data'],
                      properties: {
                        version: { type: 'string', enum: ['1'] },
                        service: { type: 'string', enum: ['zettel'] },
                        exportedAt: expect.objectContaining({ type: 'string', format: 'date-time' }),
                        data: {
                          additionalProperties: false,
                          required: ['notes', 'tags'],
                          properties: {
                            notes: expect.objectContaining({ type: 'array' }),
                            tags: expect.objectContaining({
                              type: 'array',
                              items: expect.objectContaining({
                                required: expect.arrayContaining(['id', 'name', 'createdAt']),
                              }),
                            }),
                          },
                        },
                      },
                    },
                  },
                },
              },
              401: expect.any(Object),
            },
          },
        },
      },
      components: {
        securitySchemes: {
          exportDelegationAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    })

    expect(openApiDocument.paths?.['/exports/me']?.get?.security).toEqual([
      { bearerAuth: [] },
      { exportDelegationAuth: [] },
    ])
  })

  it('documents profile preference claims with their accepted enum values', () => {
    expect(openApiDocument).toMatchObject({
      paths: {
        '/users/me': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': {
                    schema: {
                      properties: {
                        weekStart: expect.objectContaining({
                          enum: ['monday', 'sunday'],
                          nullable: true,
                        }),
                        dateFormat: expect.objectContaining({
                          enum: ['dmy', 'mdy', 'ymd'],
                          nullable: true,
                        }),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
  })
})
