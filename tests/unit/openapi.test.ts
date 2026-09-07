import test from 'node:test';
import assert from 'node:assert';
import { parseOpenApiEndpoints, detectOpenApiSpec } from '../../packages/normalizer/src/openapi.ts';

const SAMPLE_OPENAPI_3 = JSON.stringify({
  openapi: '3.0.3',
  info: {
    title: 'Payment Gateway API',
    version: '1.2.0',
    description: 'Test payment gateway with webhooks and subscriptions',
  },
  servers: [{ url: 'https://api.payment.example.com/v1' }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
    },
    schemas: {
      Subscription: {
        type: 'object',
        required: ['id', 'customer', 'status'],
        properties: {
          id: { type: 'string' },
          customer: { type: 'string' },
          status: { type: 'string' },
          created: { type: 'integer' },
        },
      },
      SubscriptionCreateRequest: {
        type: 'object',
        required: ['customer', 'price_id'],
        properties: {
          customer: { type: 'string' },
          price_id: { type: 'string' },
          coupon: { type: 'string' },
        },
      },
      ApiError: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
    parameters: {
      LimitParam: {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 20 },
      },
      CursorParam: {
        name: 'starting_after',
        in: 'query',
        required: false,
        schema: { type: 'string' },
      },
    },
  },
  paths: {
    '/subscriptions': {
      get: {
        operationId: 'listSubscriptions',
        summary: 'List active subscriptions',
        description: 'Returns a cursor-paginated list of customer subscriptions.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/LimitParam' },
          { $ref: '#/components/parameters/CursorParam' },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'List of subscriptions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    has_more: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Subscription' },
                    },
                  },
                },
                example: {
                  has_more: false,
                  data: [{ id: 'sub_123', customer: 'cus_abc', status: 'active' }],
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized access',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createSubscription',
        summary: 'Create a new subscription',
        description: 'Creates a subscription for a specific customer.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SubscriptionCreateRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Subscription created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Subscription' },
              },
            },
          },
          '400': {
            description: 'Bad request - invalid customer or price',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        },
      },
    },
    '/subscriptions/{id}': {
      delete: {
        operationId: 'cancelSubscription',
        summary: 'Cancel a subscription (deprecated)',
        deprecated: true,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Subscription cancelled',
          },
          '404': {
            description: 'Subscription not found',
          },
        },
      },
    },
  },
});

const SAMPLE_SWAGGER_2 = JSON.stringify({
  swagger: '2.0',
  info: {
    title: 'Legacy PetStore Swagger API',
    version: '1.0.0',
  },
  host: 'petstore.example.com',
  basePath: '/api',
  securityDefinitions: {
    basicAuth: {
      type: 'basic',
    },
  },
  definitions: {
    Pet: {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
      },
    },
  },
  paths: {
    '/pets': {
      post: {
        summary: 'Add a new pet',
        security: [{ basicAuth: [] }],
        parameters: [
          {
            name: 'body',
            in: 'body',
            required: true,
            schema: { $ref: '#/definitions/Pet' },
          },
        ],
        responses: {
          '200': {
            description: 'Pet created successfully',
            schema: { $ref: '#/definitions/Pet' },
          },
          '405': {
            description: 'Invalid input',
          },
        },
      },
    },
  },
});

test('OpenAPI: detectOpenApiSpec detects 3.0 and Swagger 2.0', () => {
  const openapiSummary = detectOpenApiSpec(SAMPLE_OPENAPI_3, 'https://example.com/openapi.json');
  assert.ok(openapiSummary);
  assert.strictEqual(openapiSummary.specVersion, '3.0.3');
  assert.strictEqual(openapiSummary.title, 'Payment Gateway API');
  assert.strictEqual(openapiSummary.pathCount, 2);

  const swaggerSummary = detectOpenApiSpec(SAMPLE_SWAGGER_2, 'https://example.com/swagger.json');
  assert.ok(swaggerSummary);
  assert.strictEqual(swaggerSummary.specVersion, '2.0');
  assert.strictEqual(swaggerSummary.title, 'Legacy PetStore Swagger API');
});

test('OpenAPI: parseOpenApiEndpoints extracts endpoints, $ref schemas, auth, and pagination', () => {
  const endpoints = parseOpenApiEndpoints(SAMPLE_OPENAPI_3, 'page_123', 'snap_123', 'https://example.com/openapi.json', 'v1');
  assert.strictEqual(endpoints.length, 3);

  // 1. GET /subscriptions
  const getSub = endpoints.find(e => e.method === 'get' && e.path === '/subscriptions');
  assert.ok(getSub);
  assert.strictEqual(getSub.operationId, 'listSubscriptions');
  assert.strictEqual(getSub.parameters.length, 3);

  // Check resolved parameter from components/parameters
  const limitParam = getSub.parameters.find(p => p.name === 'limit');
  assert.ok(limitParam);
  assert.strictEqual(limitParam.in, 'query');
  assert.strictEqual(limitParam.default, 20);

  // Check auth
  assert.strictEqual(getSub.auth.length, 1);
  assert.strictEqual(getSub.auth[0].type, 'http');
  assert.strictEqual(getSub.auth[0].scheme, 'bearer');

  // Check pagination heuristic (starting_after cursor + limit + has_more)
  assert.ok(getSub.pagination);
  assert.strictEqual(getSub.pagination.type, 'cursor');
  assert.ok(getSub.pagination.parameters.includes('starting_after'));
  assert.ok(getSub.pagination.parameters.includes('limit'));
  assert.ok(getSub.pagination.responseFields.includes('has_more'));

  // Check errors (401)
  assert.strictEqual(getSub.errors.length, 1);
  assert.strictEqual(getSub.errors[0].statusCode, '401');

  // 2. POST /subscriptions
  const postSub = endpoints.find(e => e.method === 'post' && e.path === '/subscriptions');
  assert.ok(postSub);
  assert.ok(postSub.requestSchema);
  assert.deepStrictEqual(postSub.requestSchema.required, ['customer', 'price_id']);
  assert.ok(postSub.responseSchema?.['201']);

  // 3. DELETE /subscriptions/{id} (deprecated)
  const delSub = endpoints.find(e => e.method === 'delete' && e.path === '/subscriptions/{id}');
  assert.ok(delSub);
  assert.strictEqual(delSub.deprecated, true);
  const pathParam = delSub.parameters.find(p => p.name === 'id');
  assert.ok(pathParam);
  assert.strictEqual(pathParam.in, 'path');
  assert.strictEqual(pathParam.required, true);
});

test('OpenAPI: Swagger 2.0 parsing and basic auth mapping', () => {
  const endpoints = parseOpenApiEndpoints(SAMPLE_SWAGGER_2, 'page_swg', 'snap_swg');
  assert.strictEqual(endpoints.length, 1);

  const postPet = endpoints[0];
  assert.strictEqual(postPet.method, 'post');
  assert.strictEqual(postPet.path, '/pets');
  assert.ok(postPet.requestSchema);
  assert.strictEqual(postPet.requestSchema.type, 'object');
  assert.deepStrictEqual(postPet.requestSchema.required, ['id', 'name']);

  // Auth mapped to http/basic
  assert.strictEqual(postPet.auth.length, 1);
  assert.strictEqual(postPet.auth[0].type, 'http');
  assert.strictEqual(postPet.auth[0].scheme, 'basic');
});

test('OpenAPI: Circular $ref references are resolved safely without recursion crash', () => {
  const circularSpec = JSON.stringify({
    openapi: '3.0.0',
    paths: {
      '/node': {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Node' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Node: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            parent: { $ref: '#/components/schemas/Node' },
          },
        },
      },
    },
  });

  const endpoints = parseOpenApiEndpoints(circularSpec, 'p_circ', 's_circ');
  assert.strictEqual(endpoints.length, 1);
  const resp = endpoints[0].responseSchema?.['200'];
  assert.ok(resp?.schema);
  assert.strictEqual(resp.schema.type, 'object');
});
