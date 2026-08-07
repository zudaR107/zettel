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
