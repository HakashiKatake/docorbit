import test from 'node:test';
import assert from 'node:assert';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import {
  CodeApiExtractor,
  SchemaVerifier,
  VerificationService,
} from '../../packages/verification/src/index.ts';
import type {
  ApiEndpoint,
  DiscoveredSource,
  NormalizedPage,
  Pitfall,
} from '../../packages/shared/src/index.ts';

function setupTestDb(): { db: DocOrbitDb; repo: DocOrbitRepository } {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  // 1. Source & Snapshot
  const src: DiscoveredSource = {
    id: 'src_stripe_v14',
    url: 'https://docs.stripe.com/api',
    type: 'openapi',
    discoveredBy: 'manual',
    authority: 'official',
    confidence: 1.0,
    status: 'valid',
    machineReadable: true,
  };
  const sourceId = repo.saveSource(src);
  const snap14 = repo.createSnapshot(sourceId, { version: 'v14' }, 'v14');

  const page: NormalizedPage = {
    id: 'page_stripe',
    sourceId: sourceId,
    title: 'Stripe API Reference',
    url: 'https://docs.stripe.com/api',
    content: 'Stripe API v14 Documentation',
    contentHash: 'hash_stripe_v14',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 2048,
    estimatedTokens: 500,
    headings: [],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
  };
  repo.savePage(page);
  repo.linkSnapshotPages(snap14, [page.id]);

  // 2. Endpoints
  const endpoints: ApiEndpoint[] = [
    {
      id: 'ep_wh_create',
      pageId: page.id,
      snapshotId: snap14,
      method: 'post',
      path: '/v1/webhook_endpoints',
      summary: 'Create a webhook endpoint',
      parameters: [
        {
          name: 'url',
          in: 'query',
          required: true,
          type: 'string',
          description: 'The URL of the webhook endpoint',
        },
      ],
      requestSchema: {
        type: 'object',
        required: ['enabled_events'],
        properties: {
          url: { type: 'string' },
          enabled_events: { type: 'array' },
        },
      },
      responseSchema: {
        '200': {
          status: 200,
          description: 'Successful response',
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              secret: { type: 'string' },
              url: { type: 'string' },
            },
          },
        },
      },
      auth: [{ type: 'bearer', scheme: 'bearer' }],
      errors: [],
      deprecated: false,
      docVersion: 'v14',
      createdAt: '2026-09-06T12:00:00Z',
    },
    {
      id: 'ep_charges_legacy',
      pageId: page.id,
      snapshotId: snap14,
      method: 'post',
      path: '/v1/charges',
      summary: 'Create a charge (deprecated in favor of PaymentIntents)',
      parameters: [
        { name: 'amount', in: 'query', required: true, type: 'integer', description: 'Amount in cents' },
      ],
      auth: [{ type: 'bearer' }],
      errors: [],
      deprecated: true,
      docVersion: 'v14',
      createdAt: '2026-09-06T12:00:00Z',
    },
  ];
  repo.saveApiEndpoints(endpoints);

  // 3. Pitfalls
  const pitfalls: Pitfall[] = [
    {
      id: 'pit_charges_dep',
      pageId: page.id,
      snapshotId: snap14,
      kind: 'deprecated',
      title: 'Charges API Deprecated',
      content: 'Use PaymentIntents instead of /v1/charges.',
      relatedApi: '/v1/charges',
      docVersion: 'v14',
      createdAt: '2026-09-06T12:00:00Z',
    },
  ];
  repo.savePitfalls(pitfalls);

  return { db, repo };
}

test('Verification: CodeApiExtractor parses JavaScript fetch, axios, and cURL calls', () => {
  const extractor = new CodeApiExtractor();

  // Test 1: Fetch
  const jsCode = `
    const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://example.com/webhook',
        enabled_events: ['payment_intent.succeeded']
      })
    });
    const data = await res.json();
    console.log(data.secret);
  `;
  const fetchCalls = extractor.extract(jsCode, 'javascript');
  assert.strictEqual(fetchCalls.length, 1);
  assert.strictEqual(fetchCalls[0].endpointPath, '/v1/webhook_endpoints');
  assert.strictEqual(fetchCalls[0].method, 'post');
  assert.ok(fetchCalls[0].bodyFields?.includes('url'));
  assert.ok(fetchCalls[0].bodyFields?.includes('enabled_events'));
  assert.ok(fetchCalls[0].responseFieldsAccessed?.includes('secret'));

  // Test 2: Axios
  const axiosCode = `
    axios.post('/v1/charges', { amount: 2000, currency: 'usd' });
  `;
  const axiosCalls = extractor.extract(axiosCode, 'typescript');
  assert.strictEqual(axiosCalls.length, 1);
  assert.strictEqual(axiosCalls[0].endpointPath, '/v1/charges');
  assert.strictEqual(axiosCalls[0].method, 'post');
  assert.ok(axiosCalls[0].bodyFields?.includes('amount'));

  // Test 3: cURL
  const curlCode = `curl -X POST https://api.stripe.com/v1/webhook_endpoints -d '{"url": "https://foo"}'`;
  const curlCalls = extractor.extract(curlCode, 'curl');
  assert.strictEqual(curlCalls.length, 1);
  assert.strictEqual(curlCalls[0].endpointPath, '/v1/webhook_endpoints');
  assert.strictEqual(curlCalls[0].method, 'post');
});

test('Verification: Valid API call returns "verified" status', () => {
  const { db, repo } = setupTestDb();
  try {
    const service = new VerificationService(repo);
    const validCode = `
      const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://myapp.com/webhook',
          enabled_events: ['charge.failed']
        })
      });
      const data = await res.json();
      console.log(data.id, data.secret);
    `;

    const { result } = service.verifyCode({
      code: validCode,
      language: 'javascript',
      version: 'v14',
    });

    assert.strictEqual(result.verdict, 'verified');
    assert.strictEqual(result.findings.length, 0);
    assert.strictEqual(result.untrusted, true);
  } finally {
    db.close();
  }
});

test('Verification: Invalid endpoint path returns "mismatch" status (error severity)', () => {
  const { db, repo } = setupTestDb();
  try {
    const service = new VerificationService(repo);
    const invalidPathCode = `
      fetch('https://api.stripe.com/v1/non_existent_endpoint', { method: 'POST' });
    `;

    const { result } = service.verifyCode({
      code: invalidPathCode,
      version: 'v14',
    });

    assert.strictEqual(result.verdict, 'mismatch');
    assert.ok(result.findings.some(f => f.rule === 'endpoint_validity' && f.severity === 'error'));
    assert.ok(result.findings[0].message.includes('does not exist'));
  } finally {
    db.close();
  }
});

test('Verification: Wrong HTTP method returns "mismatch" status', () => {
  const { db, repo } = setupTestDb();
  try {
    const service = new VerificationService(repo);
    // /v1/webhook_endpoints is POST, but caller attempts GET
    const wrongMethodCode = `
      fetch('https://api.stripe.com/v1/webhook_endpoints', { method: 'GET' });
    `;

    const { result } = service.verifyCode({
      code: wrongMethodCode,
      version: 'v14',
    });

    assert.strictEqual(result.verdict, 'mismatch');
    const methodFinding = result.findings.find(f => f.rule === 'method_validity');
    assert.ok(methodFinding);
    assert.strictEqual(methodFinding.severity, 'error');
    assert.ok(methodFinding.message.includes('does not support HTTP method "GET"'));
  } finally {
    db.close();
  }
});

test('Verification: Missing required parameters returns "mismatch" status', () => {
  const { db, repo } = setupTestDb();
  try {
    const service = new VerificationService(repo);
    // /v1/webhook_endpoints requires url and enabled_events
    // Here only 'url' is provided, 'enabled_events' is omitted
    const missingParamCode = `
      fetch('https://api.stripe.com/v1/webhook_endpoints', {
        method: 'POST',
        body: JSON.stringify({
          url: 'https://example.com/wh'
        })
      });
    `;

    const { result } = service.verifyCode({
      code: missingParamCode,
      version: 'v14',
    });

    assert.strictEqual(result.verdict, 'mismatch');
    const reqFinding = result.findings.find(f => f.rule === 'required_parameters');
    assert.ok(reqFinding);
    assert.strictEqual(reqFinding.severity, 'error');
    assert.ok(reqFinding.message.includes('Missing required body field "enabled_events"'));
  } finally {
    db.close();
  }
});

test('Verification: Deprecated API returns "warning" status with provenance', () => {
  const { db, repo } = setupTestDb();
  try {
    const service = new VerificationService(repo);
    // /v1/charges is marked deprecated
    const depCode = `
      fetch('https://api.stripe.com/v1/charges', {
        method: 'POST',
        body: JSON.stringify({ amount: 1000 })
      });
    `;

    const { result } = service.verifyCode({
      code: depCode,
      version: 'v14',
    });

    assert.strictEqual(result.verdict, 'warning');
    const depFinding = result.findings.find(f => f.rule === 'deprecation');
    assert.ok(depFinding);
    assert.strictEqual(depFinding.severity, 'warning');
    assert.ok(depFinding.message.includes('is deprecated in documentation'));
  } finally {
    db.close();
  }
});

test('Verification: Next.js version syntax conflict flags version_mismatch', () => {
  const { db, repo } = setupTestDb();
  try {
    const service = new VerificationService(repo);

    // Using Next.js 15 "await params" in a Next.js 14 project
    const asyncParamsCode = `
      export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
        const { slug } = await params;
        return <div>{slug}</div>;
      }
    `;

    const { result } = service.verifyCode({
      code: asyncParamsCode,
      version: 'v14',
    });

    assert.strictEqual(result.verdict, 'mismatch');
    const vFinding = result.findings.find(f => f.rule === 'version_mismatch');
    assert.ok(vFinding);
    assert.ok(vFinding.message.includes('Next.js 14 requires synchronous route params'));
  } finally {
    db.close();
  }
});

test('Verification: Dynamic or unsupported expressions return "insufficient_evidence"', () => {
  const { db, repo } = setupTestDb();
  try {
    const service = new VerificationService(repo);

    // Dynamic variable passed into fetch without local definition
    const dynamicCode = `
      async function sendData(apiUrl: string) {
        return fetch(apiUrl);
      }
    `;

    const { result } = service.verifyCode({
      code: dynamicCode,
      version: 'v14',
    });

    assert.strictEqual(result.verdict, 'insufficient_evidence');
    assert.ok(result.findings.some(f => f.status === 'insufficient_evidence'));
    assert.ok(result.summary.includes('insufficient evidence'));
  } finally {
    db.close();
  }
});
