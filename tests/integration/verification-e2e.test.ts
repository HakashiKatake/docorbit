import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import { WorkspaceResolver } from '../../packages/workspace/src/index.ts';
import { McpServer } from '../../packages/mcp/src/index.ts';
import type {
  DiscoveredSource,
  NormalizedPage,
  ApiEndpoint,
  Pitfall,
} from '../../packages/shared/src/index.ts';

test('Integration E2E: Verification, Diffing, and Workspace Impact in Coding Agent Workflow', async () => {
  // 1. Set up workspace
  const testDir = mkdtempSync(join(tmpdir(), 'docorbit-verify-e2e-'));
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify(
      {
        name: 'webhook-service',
        version: '1.0.0',
        dependencies: {
          stripe: '^14.15.0',
        },
      },
      null,
      2
    )
  );

  // Source files in workspace
  writeFileSync(
    join(testDir, 'webhook.ts'),
    `// Legacy webhook & charge handler
export async function createLegacyCharge() {
  const res = await fetch('https://api.stripe.com/v1/charges', {
    method: 'POST',
    body: JSON.stringify({ amount: 2000, currency: 'usd' }),
  });
  return res.json();
}
`
  );

  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);
  const resolver = new WorkspaceResolver(repo);

  try {
    // 2. Ingest documentation
    const src: DiscoveredSource = {
      id: 'src_stripe_api',
      url: 'https://docs.stripe.com/api',
      type: 'openapi',
      discoveredBy: 'manual',
      authority: 'official',
      confidence: 1.0,
      status: 'valid',
      machineReadable: true,
      metadata: { name: 'stripe' },
    };
    const sourceId = repo.saveSource(src);

    const snap14 = repo.createSnapshot(sourceId, { version: 'v14' }, 'v14');
    const snap15 = repo.createSnapshot(sourceId, { version: 'v15' }, 'v15');

    const page14: NormalizedPage = {
      id: 'page_stripe_v14',
      sourceId,
      title: 'Stripe API v14 Documentation',
      url: 'https://docs.stripe.com/v14',
      content: 'Stripe Webhooks & Charges v14 documentation.',
      contentHash: 'hash_stripe_v14',
      fetchedAt: '2026-09-06T12:00:00Z',
      rawBytes: 2000,
      estimatedTokens: 500,
      headings: [],
      links: [],
      codeExamples: [],
      securityAnnotations: [],
    };
    repo.savePage(page14);
    repo.linkSnapshotPages(snap14, [page14.id]);
    repo.linkSnapshotPages(snap15, [page14.id]);

    // Endpoints in v14:
    // - POST /v1/webhook_endpoints (requires url, enabled_events)
    // - POST /v1/charges (deprecated: false in v14)
    const endpointsV14: ApiEndpoint[] = [
      {
        id: 'ep_post_webhooks_v14',
        pageId: page14.id,
        snapshotId: snap14,
        method: 'post',
        path: '/v1/webhook_endpoints',
        summary: 'Create a webhook endpoint',
        parameters: [],
        requestSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            enabled_events: { type: 'array' },
          },
          required: ['url', 'enabled_events'],
        },
        auth: [{ type: 'bearer' }],
        errors: [],
        deprecated: false,
        docVersion: 'v14',
        createdAt: '2026-09-06T12:00:00Z',
      },
      {
        id: 'ep_post_charges_v14',
        pageId: page14.id,
        snapshotId: snap14,
        method: 'post',
        path: '/v1/charges',
        summary: 'Create a charge',
        parameters: [],
        requestSchema: {
          type: 'object',
          properties: {
            amount: { type: 'integer' },
            currency: { type: 'string' },
          },
          required: ['amount', 'currency'],
        },
        auth: [{ type: 'bearer' }],
        errors: [],
        deprecated: false,
        docVersion: 'v14',
        createdAt: '2026-09-06T12:00:00Z',
      },
    ];
    repo.saveApiEndpoints(endpointsV14);

    // Endpoints in v15:
    // - POST /v1/webhook_endpoints (present)
    // - POST /v1/charges (REMOVED)
    // - POST /v1/payment_intents (ADDED)
    const endpointsV15: ApiEndpoint[] = [
      {
        id: 'ep_post_webhooks_v15',
        pageId: page14.id,
        snapshotId: snap15,
        method: 'post',
        path: '/v1/webhook_endpoints',
        summary: 'Create a webhook endpoint',
        parameters: [],
        requestSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            enabled_events: { type: 'array' },
          },
          required: ['url', 'enabled_events'],
        },
        auth: [{ type: 'bearer' }],
        errors: [],
        deprecated: false,
        docVersion: 'v15',
        createdAt: '2026-09-06T12:00:00Z',
      },
      {
        id: 'ep_post_payment_intents_v15',
        pageId: page14.id,
        snapshotId: snap15,
        method: 'post',
        path: '/v1/payment_intents',
        summary: 'Create a PaymentIntent',
        parameters: [],
        requestSchema: {
          type: 'object',
          properties: {
            amount: { type: 'integer' },
            currency: { type: 'string' },
          },
          required: ['amount', 'currency'],
        },
        auth: [{ type: 'bearer' }],
        errors: [],
        deprecated: false,
        docVersion: 'v15',
        createdAt: '2026-09-06T12:00:00Z',
      },
    ];
    repo.saveApiEndpoints(endpointsV15);

    // Pitfall in v15: Charges API removed
    const pitfallV15: Pitfall[] = [
      {
        id: 'pit_charges_v15',
        pageId: page14.id,
        snapshotId: snap15,
        kind: 'removed',
        title: 'Charges API Removed in v15',
        content: 'Charges API (/v1/charges) is removed. Migrate to PaymentIntents.',
        relatedApi: '/v1/charges',
        docVersion: 'v15',
        createdAt: '2026-09-06T12:00:00Z',
      },
    ];
    repo.savePitfalls(pitfallV15);

    // 3. Initialize MCP server
    const server = new McpServer({
      repo,
      resolver,
      projectDir: testDir,
    });

    // --- STEP A: Agent gets implementation context, receiving verification hints ---
    const implResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'impl-1',
      method: 'tools/call',
      params: {
        name: 'get_implementation_context',
        arguments: {
          task: 'create webhook endpoint',
          project: testDir,
          library: 'stripe',
        },
      },
    });
    const defaultMarkdown = (implResponse!.result as { content: Array<{ text: string }> }).content[0].text;
    assert.ok(!defaultMarkdown.startsWith('{'), 'Should return pure markdown by default');
    assert.ok(defaultMarkdown.includes('DocOrbit Implementation Context'));

    const jsonImplResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'step-a-json',
      method: 'tools/call',
      params: {
        name: 'get_implementation_context',
        arguments: {
          task: 'create webhook endpoint',
          project: testDir,
          library: 'stripe',
          format: 'json',
        },
      },
    });
    const implData = JSON.parse((jsonImplResponse!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.ok(implData.data);
    assert.ok(Array.isArray(implData.data.verificationHints), 'Must contain verification hints array');
    const hint = implData.data.verificationHints.find((h: any) => h.endpoint === '/v1/webhook_endpoints');
    assert.ok(hint, 'Should contain verification hint for /v1/webhook_endpoints');
    assert.strictEqual(hint.method, 'POST');
    assert.deepStrictEqual(hint.requiredBodyFields, ['url', 'enabled_events']);

    // --- STEP B: Agent checks code missing required field (enabled_events) -> mismatch ---
    const invalidCodeMissingField = `
      const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://mysite.com/wh' }),
      });
    `;
    const checkMissingResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'check-1',
      method: 'tools/call',
      params: {
        name: 'check_api',
        arguments: {
          code: invalidCodeMissingField,
          language: 'typescript',
          version: 'v14',
          format: 'json',
        },
      },
    });
    const checkMissingData = JSON.parse((checkMissingResponse!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(checkMissingData.data.verdict, 'mismatch');
    const missingFieldFinding = checkMissingData.data.findings.find(
      (f: any) => f.rule === 'required_parameters'
    );
    assert.ok(missingFieldFinding, 'Must detect missing required body field');
    assert.ok(missingFieldFinding.message.includes('enabled_events'));
    assert.strictEqual(missingFieldFinding.docVersion, 'v14');

    // --- STEP C: Agent checks code with invalid HTTP method -> mismatch ---
    const invalidMethodCode = `
      const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
        method: 'GET',
      });
    `;
    const checkMethodResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'check-2',
      method: 'tools/call',
      params: {
        name: 'check_api',
        arguments: {
          code: invalidMethodCode,
          language: 'typescript',
          version: 'v14',
          format: 'json',
        },
      },
    });
    const checkMethodData = JSON.parse((checkMethodResponse!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(checkMethodData.data.verdict, 'mismatch');
    const methodFinding = checkMethodData.data.findings.find(
      (f: any) => f.rule === 'method_validity'
    );
    assert.ok(methodFinding, 'Must detect method_validity error for GET /v1/webhook_endpoints');

    // --- STEP D: Agent checks dynamic unresolvable expression -> insufficient_evidence ---
    const dynamicCode = `
      const res = await fetch(getDynamicEndpointUrl(), {
        method: 'POST',
        body: JSON.stringify({ data: 123 }),
      });
    `;
    const checkDynamicResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'check-3',
      method: 'tools/call',
      params: {
        name: 'check_api',
        arguments: {
          code: dynamicCode,
          language: 'typescript',
          version: 'v14',
          format: 'json',
        },
      },
    });
    const checkDynamicData = JSON.parse((checkDynamicResponse!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(checkDynamicData.data.verdict, 'insufficient_evidence');
    assert.ok(checkDynamicData.data.findings.some((f: any) => f.status === 'insufficient_evidence'));

    // --- STEP E: Agent checks valid code conforming to documentation -> verified! ---
    const validCode = `
      const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://mysite.com/wh',
          enabled_events: ['payment_intent.succeeded'],
        }),
      });
    `;
    const checkValidResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'check-4',
      method: 'tools/call',
      params: {
        name: 'check_api',
        arguments: {
          code: validCode,
          language: 'typescript',
          version: 'v14',
          format: 'json',
        },
      },
    });
    const checkValidData = JSON.parse((checkValidResponse!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(checkValidData.data.verdict, 'verified');
    assert.strictEqual(checkValidData.data.findings.length, 0);

    // --- STEP F: Agent calls diff_docs between v14 and v15 ---
    const diffResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'diff-1',
      method: 'tools/call',
      params: {
        name: 'diff_docs',
        arguments: {
          fromVersion: 'v14',
          toVersion: 'v15',
          format: 'json',
        },
      },
    });
    const diffData = JSON.parse((diffResponse!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(diffData.data.summary.endpointsAdded, 1);
    assert.strictEqual(diffData.data.summary.endpointsRemoved, 1);
    assert.strictEqual(diffData.data.summary.pitfallsAdded, 1);
    assert.ok(diffData.markdown.includes('API Endpoint Changes'));
    assert.ok(diffData.markdown.includes('POST /v1/charges'));

    // --- STEP G: Agent calls analyze_impact on workspace for v14 -> v15 ---
    const impactResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'impact-1',
      method: 'tools/call',
      params: {
        name: 'analyze_impact',
        arguments: {
          project: testDir,
          fromVersion: 'v14',
          toVersion: 'v15',
          format: 'json',
        },
      },
    });
    const impactData = JSON.parse((impactResponse!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(impactData.data.affectedLocations.length, 1);
    const affected = impactData.data.affectedLocations[0];
    assert.strictEqual(affected.filePath, 'webhook.ts');
    assert.strictEqual(affected.line, 3);
    assert.strictEqual(affected.changeCategory, 'removed_api');
    assert.strictEqual(affected.certainty, 'high');
    assert.ok(affected.snippet.includes('/v1/charges'));
  } finally {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }
});
