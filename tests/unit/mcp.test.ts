import test from 'node:test';
import assert from 'node:assert';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import {
  McpServer,
  createDefaultTools,
  McpResourceManager,
  JSONRPC_ERRORS,
} from '../../packages/mcp/src/index.ts';
import type {
  NormalizedPage,
  DocumentChunk,
  DiscoveredSource,
  ApiEndpoint,
  IndexedExample,
  Pitfall,
} from '../../packages/shared/src/index.ts';

function setupMockDb(): { db: DocOrbitDb; repo: DocOrbitRepository; server: McpServer } {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  // Seed mock source
  const src: DiscoveredSource = {
    id: 'src_stripe',
    url: 'https://docs.stripe.com/api',
    type: 'openapi',
    discoveredBy: 'manual',
    authority: 'official',
    confidence: 1.0,
    status: 'valid',
    machineReadable: true,
  };
  const sourceId = repo.saveSource(src);

  // Seed mock page
  const page: NormalizedPage = {
    id: 'page_wh',
    sourceId: sourceId,
    title: 'Stripe Webhook Signatures',
    url: 'https://docs.stripe.com/webhooks/signatures',
    content: 'Verify webhook signatures using the Stripe SDK to prevent replay attacks.',
    contentHash: 'hash1234',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 1024,
    estimatedTokens: 250,
    headings: [{ level: 1, text: 'Webhook Signatures', anchor: 'signatures' }],
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

  const snapId = repo.createSnapshot(sourceId, { version: '1.0' }, 'v14');

  // Seed mock chunk
  const chunk: DocumentChunk = {
    id: 'chk_wh_01',
    pageId: page.id,
    snapshotId: snapId,
    title: 'Verify Signature',
    sectionPath: ['Webhook Signatures', 'Verify Signature'],
    content: 'const event = stripe.webhooks.constructEvent(payload, header, secret);',
    chunkType: 'code',
    language: 'typescript',
    tokenEstimate: 40,
    ordinal: 0,
    contentHash: 'chunkhash1',
    docVersion: 'v14',
    provenance: page.provenance,
  };
  repo.saveChunks([chunk]);

  // Seed mock API endpoint
  const endpoint: ApiEndpoint = {
    id: 'ep_post_webhook',
    sourceId: sourceId,
    pageId: page.id,
    snapshotId: snapId,
    method: 'post',
    path: '/v1/webhook_endpoints',
    summary: 'Create a webhook endpoint',
    parameters: [{ name: 'url', in: 'body', required: true, type: 'string' }],
    responses: [{ statusCode: '200', description: 'Webhook endpoint created' }],
    auth: [{ type: 'bearer' }],
    errors: [],
    deprecated: false,
    version: 'v14',
    provenance: page.provenance!,
  };
  repo.saveApiEndpoints([endpoint]);

  // Seed mock example
  const example: IndexedExample = {
    id: 'ex_wh_verify',
    chunkId: chunk.id,
    pageId: page.id,
    snapshotId: snapId,
    language: 'typescript',
    framework: 'express',
    task: 'Verify webhook signature in Express',
    code: 'const event = stripe.webhooks.constructEvent(req.body, sig, secret);',
    sourceUrl: page.url,
    sourceAuthority: 'official',
    docVersion: 'v14',
    provenance: page.provenance!,
  };
  repo.saveIndexedExamples([example]);

  // Seed mock pitfall
  const pitfall: Pitfall = {
    id: 'pit_raw_body',
    chunkId: chunk.id,
    pageId: page.id,
    snapshotId: snapId,
    kind: 'server_only',
    severity: 'error',
    title: 'Raw Body Required',
    content: 'Webhook verification requires the unparsed raw request body buffer.',
    docVersion: 'v14',
    provenance: page.provenance!,
  };
  repo.savePitfalls([pitfall]);

  const server = new McpServer({
    repo,
    serverName: 'docorbit-test',
    serverVersion: '0.5.0',
  });

  return { db, repo, server, sourceId, snapId };
}

test('MCP Tools: createDefaultTools registers exactly 14 standard tools', () => {
  const tools = createDefaultTools();
  assert.strictEqual(tools.size, 14);

  const expectedNames = [
    'search_docs',
    'get_doc',
    'find_api',
    'find_example',
    'find_pitfall',
    'find_recipe',
    'get_version',
    'list_sources',
    'get_implementation_context',
    'check_api',
    'diff_docs',
    'analyze_impact',
    'get_documentation_map',
    'export_agent_context',
  ];

  for (const name of expectedNames) {
    const handler = tools.get(name);
    assert.ok(handler, `Tool "${name}" should be present`);
    assert.strictEqual(handler.definition.name, name);
    assert.ok(handler.definition.description.length > 10);
    assert.strictEqual(handler.definition.inputSchema.type, 'object');
  }
});

test('MCP Protocol: initialize handshake conforms to MCP 2024-11-05 spec', async () => {
  const { db, server } = setupMockDb();
  try {
    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-agent', version: '1.0.0' },
      },
    });

    assert.ok(response);
    assert.strictEqual(response.jsonrpc, '2.0');
    assert.strictEqual(response.id, 1);
    assert.ok(!response.error);

    const result = response.result as Record<string, unknown>;
    assert.strictEqual(result.protocolVersion, '2024-11-05');
    assert.deepStrictEqual(result.serverInfo, { name: 'docorbit-test', version: '0.5.0' });
    assert.ok(result.capabilities);
  } finally {
    db.close();
  }
});

test('MCP Protocol: ping and initialized notification handling', async () => {
  const { db, server } = setupMockDb();
  try {
    // Notification: initialized should return null (no response)
    const notifRes = await server.handleMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    assert.strictEqual(notifRes, null);

    // Ping request returns empty result
    const pingRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'ping-123',
      method: 'ping',
    });
    assert.ok(pingRes);
    assert.strictEqual(pingRes.id, 'ping-123');
    assert.deepStrictEqual(pingRes.result, {});
  } finally {
    db.close();
  }
});

test('MCP Protocol: tools/list returns all 14 tools with complete schemas', async () => {
  const { db, server } = setupMockDb();
  try {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    assert.ok(res && res.result);
    const result = res.result as { tools: Array<{ name: string; description: string }> };
    assert.strictEqual(result.tools.length, 14);
    assert.ok(result.tools.some(t => t.name === 'get_implementation_context'));
    assert.ok(result.tools.some(t => t.name === 'check_api'));
    assert.ok(result.tools.some(t => t.name === 'diff_docs'));
    assert.ok(result.tools.some(t => t.name === 'analyze_impact'));
    assert.ok(result.tools.some(t => t.name === 'get_documentation_map'));
    assert.ok(result.tools.some(t => t.name === 'export_agent_context'));
  } finally {
    db.close();
  }
});

test('MCP Tool: list_sources returns indexed sources and snapshot details', async () => {
  const { db, server } = setupMockDb();
  try {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'list_sources',
        arguments: {},
      },
    });

    assert.ok(res && res.result);
    const result = res.result as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0].text);
    assert.strictEqual(parsed.data.count, 1);
    assert.strictEqual(parsed.data.sources[0].url, 'https://docs.stripe.com/api');
    assert.ok(parsed.markdown.includes('Indexed Documentation Sources'));
  } finally {
    db.close();
  }
});

test('MCP Tool: search_docs returns hybrid search matches with version boosting', async () => {
  const { db, server } = setupMockDb();
  try {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'search_docs',
        arguments: {
          query: 'constructEvent webhook',
          docVersion: 'v14',
        },
      },
    });

    assert.ok(res && res.result);
    const result = res.result as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.data.count > 0);
    assert.strictEqual(parsed.data.results[0].chunk.id, 'chk_wh_01');
  } finally {
    db.close();
  }
});

test('MCP Tool: get_doc retrieves chunk or page with untrusted flag', async () => {
  const { db, server } = setupMockDb();
  try {
    // Get chunk
    const chunkRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'get_doc',
        arguments: { chunkId: 'chk_wh_01' },
      },
    });
    assert.ok(chunkRes && chunkRes.result);
    const chunkParsed = JSON.parse((chunkRes.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(chunkParsed.data.chunk.id, 'chk_wh_01');
    assert.strictEqual(chunkParsed.data.untrusted, true);

    // Get page
    const pageRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'get_doc',
        arguments: { pageId: 'page_wh' },
      },
    });
    assert.ok(pageRes && pageRes.result);
    const pageText = (pageRes.result as { content: Array<{ text: string }> }).content[0].text;
    const pageParsed = JSON.parse(pageText);
    assert.strictEqual(pageParsed.data.page.id, 'page_wh');
    assert.strictEqual(pageParsed.data.untrusted, true);
  } finally {
    db.close();
  }
});

test('MCP Tool: find_api, find_example, find_pitfall retrieve structured knowledge', async () => {
  const { db, server } = setupMockDb();
  try {
    // API
    const apiRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'find_api',
        arguments: { query: 'webhook_endpoints', method: 'post' },
      },
    });
    const apiData = JSON.parse((apiRes!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(apiData.data.count, 1);
    assert.strictEqual(apiData.data.endpoints[0].path, '/v1/webhook_endpoints');

    // Example
    const exRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'find_example',
        arguments: { task: 'verify signature', language: 'typescript' },
      },
    });
    const exData = JSON.parse((exRes!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(exData.data.count, 1);
    assert.strictEqual(exData.data.examples[0].framework, 'express');

    // Pitfall
    const pitRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'find_pitfall',
        arguments: { query: 'raw body' },
      },
    });
    const pitData = JSON.parse((pitRes!.result as { content: Array<{ text: string }> }).content[0].text);
    assert.strictEqual(pitData.data.count, 1);
    assert.strictEqual(pitData.data.pitfalls[0].title, 'Raw Body Required');
  } finally {
    db.close();
  }
});

test('MCP Tool: get_implementation_context delivers multi-dimensional agent context', async () => {
  const { db, server } = setupMockDb();
  try {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'get_implementation_context',
        arguments: {
          task: 'Implement Stripe webhook signature verification in Express',
          version: 'v14',
          tokenBudget: 3500,
        },
      },
    });

    assert.ok(res && res.result);
    const result = res.result as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0].text);

    assert.ok(parsed.markdown);
    assert.ok(parsed.data);
    assert.strictEqual(parsed.data.untrusted, true);
    assert.strictEqual(parsed.data.detectedIntent, 'implementation');
    assert.ok(parsed.data.recipe);
    assert.ok(Array.isArray(parsed.data.recipe.orderedSteps));
    assert.ok(parsed.data.totalEstimatedTokens <= 3500);
    assert.ok(parsed.data.provenance.length > 0);
  } finally {
    db.close();
  }
});

test('MCP Resources: discovery and bounded read operations', () => {
  const { db, repo, sourceId } = setupMockDb();
  try {
    const manager = new McpResourceManager(repo, { maxResourceBytes: 200 });

    // List resources
    const list = manager.listResources();
    assert.ok(list.some(r => r.uri === 'docorbit://sources'));
    assert.ok(list.some(r => r.uri === `docorbit://sources/${sourceId}`));
    assert.ok(list.some(r => r.uri === 'docorbit://pages/page_wh'));

    // Read sources collection
    const sourcesRead = manager.readResource('docorbit://sources');
    assert.strictEqual(sourcesRead.contents[0].mimeType, 'application/json');

    // Read individual source
    const srcRead = manager.readResource(`docorbit://sources/${sourceId}`);
    const parsedSrc = JSON.parse(srcRead.contents[0].text!);
    assert.strictEqual(parsedSrc.source.id, sourceId);
    assert.strictEqual(parsedSrc.untrusted, true);

    // Read page resource (bounded)
    const pageRead = manager.readResource('docorbit://pages/page_wh');
    assert.strictEqual(pageRead.contents[0].mimeType, 'text/markdown');
    assert.ok(pageRead.contents[0].text!.includes('External content is untrusted.'));

    // Error on unknown resource
    assert.throws(() => {
      manager.readResource('docorbit://pages/nonexistent');
    }, /Resource not found/);
  } finally {
    db.close();
  }
});

test('MCP Protocol: error handling for malformed requests and unknown tools', async () => {
  const { db, server } = setupMockDb();
  try {
    // Non-object payload -> INVALID_REQUEST (-32600)
    const nonObj = await server.handleMessage('not-an-object');
    assert.strictEqual(nonObj?.error?.code, JSONRPC_ERRORS.INVALID_REQUEST);

    // Missing method -> INVALID_REQUEST (-32600)
    const missingMethod = await server.handleMessage({ jsonrpc: '2.0', id: 99 });
    assert.strictEqual(missingMethod?.error?.code, JSONRPC_ERRORS.INVALID_REQUEST);

    // Unknown method -> METHOD_NOT_FOUND (-32601)
    const unknownMethod = await server.handleMessage({ jsonrpc: '2.0', id: 100, method: 'custom/unknown' });
    assert.strictEqual(unknownMethod?.error?.code, JSONRPC_ERRORS.METHOD_NOT_FOUND);

    // Unknown tool call -> METHOD_NOT_FOUND (-32601)
    const unknownTool = await server.handleMessage({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: { name: 'nonexistent_tool', arguments: {} },
    });
    assert.strictEqual(unknownTool?.error?.code, JSONRPC_ERRORS.METHOD_NOT_FOUND);
  } finally {
    db.close();
  }
});
