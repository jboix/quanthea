/** The OpenAPI description of the dev HTTP API, as the HTTP connector reads it. */

/** A time parameter: ISO 8601 or epoch seconds. */
const timeParameter = (name: string, description: string) => ({
  name,
  in: 'query',
  description,
  schema: { type: 'string', format: 'date-time' },
});

/** The description. */
export const openApi = {
  openapi: '3.1.0',
  info: { title: 'Shop operations API', version: '1.4.2' },
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Deploy: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          service: {
            type: 'string',
            enum: ['checkout-svc', 'payments-svc', 'cart-svc', 'catalog-svc'],
          },
          version: { type: 'string' },
          deployed_at: { type: 'string', format: 'date-time', description: 'When it went live.' },
          author: { type: 'string' },
        },
      },
    },
  },
  security: [{ bearer: [] }],
  paths: {
    '/api/v1/services': {
      get: {
        summary: 'The services of the shop.',
        responses: {
          '200': {
            description: 'The services.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      team: { type: 'string' },
                      tier: { type: 'string', enum: ['critical', 'standard'] },
                      peak_rps: {
                        type: 'number',
                        description: 'Requests per second at the daily peak.',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/deploys': {
      get: {
        summary: 'Production deploys, newest last.',
        parameters: [
          {
            name: 'service',
            in: 'query',
            description: 'Repeat to ask for several.',
            schema: {
              type: 'string',
              enum: ['checkout-svc', 'payments-svc', 'cart-svc', 'catalog-svc'],
            },
          },
          timeParameter('from', 'The earliest deploy time.'),
          timeParameter('to', 'The latest deploy time.'),
        ],
        responses: {
          '200': {
            description: 'The deploys.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Deploy' } },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/services/{service}/errors': {
      parameters: [{ name: 'service', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        summary: 'Requests and 5xx errors of a service over time.',
        parameters: [
          timeParameter('from', 'The start; ISO or epoch seconds.'),
          timeParameter('to', 'The end; ISO or epoch seconds.'),
          {
            name: 'step',
            in: 'query',
            description: 'Seconds per point.',
            schema: { type: 'integer' },
          },
        ],
        responses: {
          '200': {
            description: 'One point per step.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    service: { type: 'string' },
                    points: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          t: {
                            type: 'integer',
                            description: 'The start of the step, in epoch seconds.',
                          },
                          requests: { type: 'integer' },
                          errors: { type: 'integer' },
                          error_ratio: { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/errors/search': {
      post: {
        summary: 'Request and error totals of several services over a time range.',
        responses: {
          '200': {
            description: 'One row per service.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          service: { type: 'string' },
                          requests: { type: 'integer' },
                          errors: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/status': {
      get: {
        summary: 'The health of the service behind the API.',
        responses: {
          '200': {
            description: 'The checks.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    version: { type: 'string' },
                    checks: {
                      type: 'object',
                      properties: {
                        database: {
                          type: 'object',
                          properties: { ok: { type: 'boolean' }, latency_ms: { type: 'integer' } },
                        },
                        queue: {
                          type: 'object',
                          properties: { ok: { type: 'boolean' }, depth: { type: 'integer' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
