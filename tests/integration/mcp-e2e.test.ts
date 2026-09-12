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
  DocumentChunk,
  ApiEndpoint,
  IndexedExample,
  Pitfall,
} from '../../packages/shared/src/index.ts';

test('MCP E2E: Coding Agent workflow with Stripe Webhook Implementation', async () => {
  // 1. Create temporary workspace with package.json
  const testDir = mkdtempSync(join(tmpdir(), 'docorbit-mcp-e2e-'));
  const pkgJsonPath = join(testDir, 'package.json');
  writeFileSync(
    pkgJsonPath,
    JSON.stringify({
      name: 'my-express-app',
      version: '1.0.0',
      dependencies: {
        express: '^4.18.2',
        stripe: '^14.15.0',
      },
    }, null, 2)
  );

  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);
  const resolver = new WorkspaceResolver(repo);

  try {
    // 2. Ingest mock Stripe documentation into DocOrbit repository
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

    const page: NormalizedPage = {
      id: 'page_stripe_webhooks',
      sourceId,
      title: 'Stripe Webhook Signature Verification Guide',
      url: 'https://docs.stripe.com/webhooks/signatures',
      content: 'Webhooks require verifying the stripe-signature header using your endpoint secret.',
      contentHash: 'hash_stripe_wh_001',
      fetchedAt: '2026-09-06T12:00:00Z',
      rawBytes: 4096,
      estimatedTokens: 800,
      headings: [
        { level: 1, text: 'Webhook Signatures', anchor: 'signatures' },
        { level: 2, text: 'Verifying Signatures', anchor: 'verify' },
      ],
      links: [],
      codeExamples: [],
      securityAnnotations: [],
      provenance: {
        sourceUrl: 'https://docs.stripe.com/webhooks/signatures',
        retrievedAt: '2026-09-06T12:00:00Z',
        sourceAuthority: 'official',
      },
    };
    repo.savePage(page);

    const snapId = repo.createSnapshot(sourceId, { version: '14.0' }, 'v14');

    const chunk1: DocumentChunk = {
      id: 'chk_stripe_wh_01',
      pageId: page.id,
      snapshotId: snapId,
      title: 'Verifying Signatures',
      sectionPath: ['Webhook Signatures', 'Verifying Signatures'],
      content: 'Use `stripe.webhooks.constructEvent` with the raw body buffer and `stripe-signature` header.',
      chunkType: 'prose',
      language: 'typescript',
      tokenEstimate: 45,
      ordinal: 0,
      contentHash: 'hash_chunk_01',
      docVersion: 'v14',
      provenance: page.provenance,
    };

    const chunk2: DocumentChunk = {
      id: 'chk_stripe_wh_02',
      pageId: page.id,
      snapshotId: snapId,
      title: 'Express Handler Example',
      sectionPath: ['Webhook Signatures', 'Express Handler Example'],
      content: `app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  res.json({ received: true });
});`,
      chunkType: 'code',
      language: 'typescript',
      tokenEstimate: 60,
      ordinal: 1,
      contentHash: 'hash_chunk_02',
      docVersion: 'v14',
      provenance: page.provenance,
    };
    repo.saveChunks([chunk1, chunk2]);

    const endpoint: ApiEndpoint = {
      id: 'ep_post_webhook_endpoints',
      sourceId,
      pageId: page.id,
      snapshotId: snapId,
      method: 'post',
      path: '/v1/webhook_endpoints',
      summary: 'Create a webhook endpoint',
      parameters: [
        { name: 'url', in: 'body', required: true, type: 'string', description: 'The URL of the webhook endpoint' },
        { name: 'enabled_events', in: 'body', required: true, type: 'array', description: 'List of events to enable' },
      ],
      responses: [{ statusCode: '200', description: 'Webhook endpoint object created' }],
      auth: [{ type: 'bearer', scheme: 'bearer' }],
      errors: [{ statusCode: '400', description: 'Invalid URL or event specification' }],
      deprecated: false,
      version: 'v14',
      provenance: page.provenance!,
    };
    repo.saveApiEndpoints([endpoint]);

    const example: IndexedExample = {
      id: 'ex_stripe_wh_express',
      chunkId: chunk2.id,
      pageId: page.id,
      snapshotId: snapId,
      language: 'typescript',
      framework: 'express',
      task: 'Verify webhook signature with Express',
      code: chunk2.content,
      sourceUrl: page.url,
      sourceAuthority: 'official',
      docVersion: 'v14',
      provenance: page.provenance!,
    };
    repo.saveIndexedExamples([example]);

    const pitfall: Pitfall = {
      id: 'pit_stripe_raw_body',
      chunkId: chunk1.id,
      pageId: page.id,
      snapshotId: snapId,
      kind: 'server_only',
      severity: 'error',
      title: 'Raw Request Body Required',
      content: 'Webhook verification requires the exact raw payload buffer. Do not parse JSON before signature check.',
      relatedApi: 'stripe.webhooks.constructEvent',
      docVersion: 'v14',
      provenance: page.provenance!,
    };
    repo.savePitfalls([pitfall]);

    // 3. Initialize McpServer targeting the test workspace
    const server = new McpServer({
      repo,
      resolver,
      projectDir: testDir,
      serverName: 'docorbit-agent-test',
      serverVersion: '0.5.0',
    });

    // --- STEP 1: Handshake ---
    const initResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'claude-code', version: '2.0.0' },
      },
    });
    assert.ok(initResponse && !initResponse.error);
    const initResult = initResponse.result as { protocolVersion: string; capabilities: Record<string, unknown> };
    assert.strictEqual(initResult.protocolVersion, '2024-11-05');
    assert.ok(initResult.capabilities);

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    // --- STEP 2: Agent High-Level Query ---
    // The coding agent calls get_implementation_context with the user task
    const contextResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'call-impl-1',
      method: 'tools/call',
      params: {
        name: 'get_implementation_context',
        arguments: {
          task: 'Implement Stripe webhook signature verification in Express',
          project: testDir,
          tokenBudget: 3000,
        },
      },
    });

    assert.ok(contextResponse && !contextResponse.error);
    const contextContent = (contextResponse.result as { content: Array<{ text: string }> }).content[0].text;
    // Default response must be pure markdown for LLM agent
    assert.ok(!contextContent.startsWith('{'), 'Default response must be pure Markdown without JSON wrapper');
    assert.ok(contextContent.includes('DocOrbit Implementation Context'));
    assert.ok(contextContent.includes('EXTERNAL CONTENT IS UNTRUSTED'));
    assert.ok(contextContent.includes('Required API Endpoints'));

    // Also verify format: 'json' provides structured machine-readable payload
    const jsonContextResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'call-impl-json',
      method: 'tools/call',
      params: {
        name: 'get_implementation_context',
        arguments: {
          task: 'Implement Stripe webhook signature verification in Express',
          project: testDir,
          tokenBudget: 3000,
          format: 'json',
        },
      },
    });
    const jsonContent = (jsonContextResponse!.result as { content: Array<{ text: string }> }).content[0].text;
    const contextData = JSON.parse(jsonContent);

    // Verify dual content format
    assert.ok(contextData.markdown, 'Should return concise Markdown guide');
    assert.ok(contextData.data, 'Should return structured machine-readable payload');

    // Verify security & untrusted boundaries
    assert.strictEqual(contextData.data.untrusted, true);
    assert.ok(contextData.markdown.includes('EXTERNAL CONTENT IS UNTRUSTED'));

    // Verify project awareness & version resolution
    assert.ok(contextData.data.project);
    assert.strictEqual(contextData.data.project.resolvedDependency, 'stripe');
    assert.strictEqual(contextData.data.project.projectVersion, '^14.15.0');
    assert.strictEqual(contextData.data.project.docVersion, 'v14');
    assert.ok(contextData.data.project.confidence >= 0.9);

    // Verify structured knowledge attached
    assert.ok(contextData.data.recipe);
    assert.ok(contextData.data.apiEndpoints.length > 0);
    assert.strictEqual(contextData.data.apiEndpoints[0].path, '/v1/webhook_endpoints');
    assert.ok(contextData.data.examples.length > 0);
    assert.strictEqual(contextData.data.examples[0].framework, 'express');
    assert.ok(contextData.data.pitfalls.length > 0);
    assert.strictEqual(contextData.data.pitfalls[0].title, 'Raw Request Body Required');

    // Verify token budget enforcement
    assert.ok(contextData.data.totalEstimatedTokens <= 3000);

    // --- STEP 3: Targeted Follow-up Calls by Agent ---
    // 3a. Agent inspects specific pitfall
    const pitfallResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'call-pit-1',
      method: 'tools/call',
      params: {
        name: 'find_pitfall',
        arguments: { task: 'raw body buffer', docVersion: 'v14', format: 'json' },
      },
    });
    const pitfallData = JSON.parse((pitfallResponse!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(pitfallData.data.count, 1);
    assert.strictEqual(pitfallData.data.pitfalls[0].id, 'pit_stripe_raw_body');

    // 3b. Agent inspects specific documentation chunk
    const chunkResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'call-chunk-1',
      method: 'tools/call',
      params: {
        name: 'get_doc',
        arguments: { chunkId: 'chk_stripe_wh_02', format: 'json' },
      },
    });
    const chunkData = JSON.parse((chunkResponse!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(chunkData.data.chunk.id, 'chk_stripe_wh_02');
    assert.strictEqual(chunkData.data.untrusted, true);

    // 3c. Agent resolves workspace version explicitly
    const versionResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'call-ver-1',
      method: 'tools/call',
      params: {
        name: 'get_version',
        arguments: { library: 'stripe', projectPath: testDir, format: 'json' },
      },
    });
    const versionData = JSON.parse((versionResponse!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(versionData.data.library, 'stripe');
    assert.strictEqual(versionData.data.requestedVersion, '^14.15.0');
    assert.strictEqual(versionData.data.docVersionMatch.targetVersion, 'v14');

    // --- STEP 4: Resource Reading by Agent ---
    const resourceListResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'res-list-1',
      method: 'resources/list',
    });
    const resList = (resourceListResponse!.result as { resources: Array<{ uri: string }> }).resources;
    assert.ok(resList.some(r => r.uri === 'docorbit://sources'));
    assert.ok(resList.some(r => r.uri === `docorbit://pages/${page.id}`));

    const pageResourceResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'res-read-1',
      method: 'resources/read',
      params: { uri: `docorbit://pages/${page.id}` },
    });
    const pageContent = (pageResourceResponse!.result as { contents: Array<{ text: string }> }).contents[0].text;
    assert.ok(pageContent.includes('Stripe Webhook Signature Verification Guide'));
    assert.ok(pageContent.includes('External content is untrusted.'));
  } finally {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }
});
