import test from 'node:test';
import assert from 'node:assert';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import { RecipeEngine } from '../../packages/retrieval/src/recipe-engine.ts';
import type { NormalizedPage, ApiEndpoint, IndexedExample, Pitfall } from '../../packages/shared/src/index.ts';

test('Recipes: assembleRecipe compiles evidence-grounded recipe with explicit evidence levels', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);
  const engine = new RecipeEngine(repo);

  const page: NormalizedPage = {
    id: 'page_rec',
    sourceId: 'src_rec',
    snapshotId: 'snap_rec',
    url: 'https://api.stripe.example.com/docs',
    title: 'Stripe Subscriptions Documentation',
    content: 'Full subscriptions guide',
    contentHash: 'hash_rec',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 2048,
    estimatedTokens: 300,
    headings: [],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: {
      sourceUrl: 'https://api.stripe.example.com/docs',
      retrievedAt: '2026-09-06T12:00:00Z',
      sourceAuthority: 'official',
    },
  };

  const sourceId = repo.saveSource({
    url: page.url,
    type: 'web',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: false,
  });
  page.sourceId = sourceId;
  repo.savePage(page);

  // 1. Indexed API Endpoint with response schema and parameters
  const endpoint: ApiEndpoint = {
    id: 'ep_create_sub',
    pageId: page.id,
    snapshotId: page.snapshotId,
    method: 'post',
    path: '/v1/subscriptions',
    summary: 'Create customer subscription',
    description: 'Creates a recurring billing subscription for a customer',
    parameters: [
      { name: 'customer', in: 'query', required: true, type: 'string' },
      { name: 'price', in: 'query', required: true, type: 'string' },
    ],
    responseSchema: {
      '200': {
        statusCode: '200',
        description: 'Subscription created',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            customer: { type: 'string' },
          },
        },
      },
    },
    auth: [{ type: 'http', scheme: 'bearer' }],
    errors: [{ statusCode: '400', description: 'Invalid parameter' }],
    deprecated: false,
    docVersion: 'v1',
    provenance: page.provenance,
    createdAt: '2026-09-06T12:00:00Z',
  };
  repo.saveApiEndpoints([endpoint]);

  // 2. Indexed Example
  const example: IndexedExample = {
    id: 'ex_create_sub',
    pageId: page.id,
    snapshotId: page.snapshotId,
    language: 'typescript',
    framework: 'express',
    task: 'Create Subscription',
    code: `const subscription = await stripe.subscriptions.create({\n  customer: 'cus_123',\n  items: [{ price: 'price_abc' }],\n});`,
    sourceUrl: page.url,
    sourceAuthority: 'official',
    relatedApi: 'POST /v1/subscriptions',
    docVersion: 'v1',
    createdAt: '2026-09-06T12:00:00Z',
  };
  repo.saveIndexedExamples([example]);

  // 3. Pitfalls
  const pitfall: Pitfall = {
    id: 'pf_req_key',
    pageId: page.id,
    snapshotId: page.snapshotId,
    kind: 'required_config',
    title: 'Secret Key Required',
    content: 'STRIPE_SECRET_KEY environment variable is required before creating subscriptions.',
    docVersion: 'v1',
    provenance: page.provenance,
    createdAt: '2026-09-06T12:00:00Z',
  };
  repo.savePitfalls([pitfall]);

  // Assemble recipe
  const recipe = await engine.assembleRecipe('create subscription', { docVersion: 'v1' });

  // 1. Verify Prerequisites are grounded in documented facts
  assert.strictEqual(recipe.prerequisites.length, 1);
  assert.strictEqual(recipe.prerequisites[0].evidenceLevel, 'documented_fact');
  assert.ok(recipe.prerequisites[0].text.includes('STRIPE_SECRET_KEY environment variable is required'));

  // 2. Verify Steps are strictly documented facts with API and code
  assert.ok(recipe.orderedSteps.length >= 1);
  const mainStep = recipe.orderedSteps.find(s => s.apiEndpoint === 'POST /v1/subscriptions');
  assert.ok(mainStep);
  assert.strictEqual(mainStep.evidenceLevel, 'documented_fact');
  assert.strictEqual(mainStep.exampleCode, example.code);
  assert.strictEqual(mainStep.sourceUrl, page.url);

  // 3. Verify Validation Steps are derived from response schema
  assert.ok(recipe.validationSteps.length >= 1);
  const valStep = recipe.validationSteps[0];
  assert.strictEqual(valStep.evidenceLevel, 'documented_fact');
  assert.ok(valStep.description.includes('HTTP 200'));
  assert.ok(valStep.description.includes('id, status, customer'));

  // 4. Verify Confidence is high due to comprehensive facts
  assert.ok(recipe.confidence >= 0.7);

  db.close();
});

test('Recipes: Undocumented requirements produce explicit missing_information with strict evidence-grounding', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);
  const engine = new RecipeEngine(repo);

  const recipe = await engine.assembleRecipe('quantum warp drive warpFactor parameter validation');

  // No ungrounded steps or fake validation assertions
  assert.strictEqual(recipe.prerequisites.length, 0);
  assert.strictEqual(recipe.orderedSteps.length, 1);
  assert.strictEqual(recipe.orderedSteps[0].evidenceLevel, 'missing_information');
  assert.strictEqual(recipe.orderedSteps[0].title, 'Missing Implementation Knowledge');

  assert.strictEqual(recipe.validationSteps.length, 1);
  assert.strictEqual(recipe.validationSteps[0].evidenceLevel, 'missing_information');
  assert.strictEqual(recipe.confidence, 0);

  db.close();
});
