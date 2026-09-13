import test from 'node:test';
import assert from 'node:assert';
import { formatToolResponse, MAX_TOOL_OUTPUT_CHARS } from '../../src/mcp/tools/types.ts';
import { FindPitfallTool } from '../../src/mcp/tools/find-pitfall.ts';
import { DocOrbitDb, DocOrbitRepository } from '../../src/storage/index.ts';
import { DOCORBIT_VERSION } from '../../src/shared/index.ts';
import { McpServer } from '../../src/mcp/server.ts';

test('MCP Safety: formatToolResponse caps oversized markdown output at default 60,000 chars', () => {
  const hugeMarkdown = 'A'.repeat(MAX_TOOL_OUTPUT_CHARS + 50_000);
  const res = formatToolResponse(hugeMarkdown);

  assert.strictEqual(res.content.length, 1);
  assert.strictEqual(res.content[0].type, 'text');
  assert.ok(res.content[0].text.length <= MAX_TOOL_OUTPUT_CHARS);
  assert.ok(res.content[0].text.includes('... [Response truncated: output exceeded size limit]'));
});

test('MCP Safety: formatToolResponse respects DOCORBIT_MAX_TOOL_OUTPUT_CHARS with safe clamping', () => {
  const origEnv = process.env.DOCORBIT_MAX_TOOL_OUTPUT_CHARS;
  try {
    // Test custom valid limit
    process.env.DOCORBIT_MAX_TOOL_OUTPUT_CHARS = '2000';
    const res = formatToolResponse('B'.repeat(5000));
    assert.ok(res.content[0].text.length <= 2000);

    // Test unsafe/unbounded high value - must clamp to ABSOLUTE_MAX_TOOL_OUTPUT_CHARS (120,000)
    process.env.DOCORBIT_MAX_TOOL_OUTPUT_CHARS = '999999999';
    const resHigh = formatToolResponse('C'.repeat(200_000));
    assert.ok(resHigh.content[0].text.length <= 120_000);

    // Test invalid / negative value - falls back to default 60,000
    process.env.DOCORBIT_MAX_TOOL_OUTPUT_CHARS = '-500';
    const resNeg = formatToolResponse('D'.repeat(100_000));
    assert.ok(resNeg.content[0].text.length <= 60_000);

    // Test minimum floor (clamped to 500)
    process.env.DOCORBIT_MAX_TOOL_OUTPUT_CHARS = '100';
    const resFloor = formatToolResponse('E'.repeat(2000));
    assert.ok(resFloor.content[0].text.length <= 500);
  } finally {
    if (origEnv !== undefined) {
      process.env.DOCORBIT_MAX_TOOL_OUTPUT_CHARS = origEnv;
    } else {
      delete process.env.DOCORBIT_MAX_TOOL_OUTPUT_CHARS;
    }
  }
});

test('MCP Safety: formatToolResponse caps oversized json payload and keeps JSON valid', () => {
  const hugeData = {
    query: 'test_query',
    count: 5000,
    bigArray: Array.from({ length: 5000 }, (_, i) => ({
      index: i,
      data: 'Very large payload '.repeat(20),
    })),
  };

  const res = formatToolResponse('Normal markdown', hugeData, { format: 'json' });
  assert.strictEqual(res.content.length, 1);
  const parsed = JSON.parse(res.content[0].text);
  assert.strictEqual(parsed.truncated, true);
  assert.strictEqual(parsed.metadata.query, 'test_query');
  assert.strictEqual(parsed.metadata.count, 5000);
  assert.ok(parsed.truncationReason.includes('exceeded safety limit'));
  assert.ok(res.content[0].text.length <= MAX_TOOL_OUTPUT_CHARS);
});

test('MCP Safety: formatToolResponse produces valid JSON even when markdown inside JSON is oversized', () => {
  const hugeMarkdown = 'M'.repeat(150_000);
  const hugeData = {
    query: 'huge_task',
    array: Array.from({ length: 1000 }, (_, i) => ({ i })),
  };

  const res = formatToolResponse(hugeMarkdown, hugeData, { format: 'json' });
  assert.strictEqual(res.content.length, 1);
  // Must parse as valid JSON
  const parsed = JSON.parse(res.content[0].text);
  assert.strictEqual(parsed.truncated, true);
  assert.ok(res.content[0].text.length <= MAX_TOOL_OUTPUT_CHARS);
  assert.strictEqual(parsed.metadata.query, 'huge_task');
});

test('MCP Safety: FindPitfallTool caps individual pitfall content at 1500 chars', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  const sourceId = repo.saveSource({
    url: 'https://example.com/docs',
    type: 'web',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: true,
  });

  const snapshotId = repo.createSnapshot(sourceId, {
    targetUrl: 'https://example.com/docs',
    pageCount: 1,
    ingestedAt: new Date().toISOString(),
  });

  const pageId = 'page_pf_test';
  repo.savePage({
    id: pageId,
    sourceId,
    snapshotId,
    url: 'https://example.com/docs/api',
    title: 'Test API',
    content: 'Some test content',
    contentHash: 'hash_test_1',
    fetchedAt: new Date().toISOString(),
    rawBytes: 100,
    estimatedTokens: 25,
    headings: [],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: { sourceUrl: 'https://example.com/docs/api', retrievedAt: new Date().toISOString(), sourceAuthority: 'official' },
  });

  const hugePitfallContent = 'DANGEROUS_CALL '.repeat(300); // ~4500 chars
  repo.savePitfalls([
    {
      id: 'pf_huge_1',
      pageId,
      snapshotId,
      kind: 'gotcha',
      title: 'Oversized Gotcha Warning',
      content: hugePitfallContent,
      createdAt: new Date().toISOString(),
      provenance: { sourceUrl: 'https://example.com/docs/api', retrievedAt: new Date().toISOString(), sourceAuthority: 'official' },
    },
  ]);

  const tool = new FindPitfallTool();
  const ctx = {
    repo,
    implService: {} as any,
    implementationService: {} as any,
  };

  const result = await tool.execute({ query: 'Oversized' }, ctx);
  assert.strictEqual(result.content.length, 1);
  const outputText = result.content[0].text;
  assert.ok(outputText.includes('... [Content truncated]'));
  assert.ok(outputText.length < 2500);

  db.close();
});

test('Database Sanitization: automatically cleans legacy OpenAPI dumps and truncates oversized pitfalls', () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  const sourceId = repo.saveSource({
    url: 'https://example.com/spec.json',
    type: 'openapi',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: true,
  });

  const snapshotId = repo.createSnapshot(sourceId, {
    targetUrl: 'https://example.com/spec.json',
    pageCount: 1,
    ingestedAt: new Date().toISOString(),
  });

  const pageId = 'page_sanitize_test';
  repo.savePage({
    id: pageId,
    sourceId,
    snapshotId,
    url: 'https://example.com/spec.json',
    title: 'Spec',
    content: 'Spec markdown',
    contentHash: 'hash_spec',
    fetchedAt: new Date().toISOString(),
    rawBytes: 100,
    estimatedTokens: 25,
    headings: [],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: { sourceUrl: 'https://example.com/spec.json', retrievedAt: new Date().toISOString(), sourceAuthority: 'official' },
  });

  const rawDb = db.getRawDb();
  rawDb.exec(`
    INSERT INTO pitfalls (id, page_id, snapshot_id, kind, title, content, created_at, provenance_json)
    VALUES
      ('pf_openapi_dump', '${pageId}', '${snapshotId}', 'rate_limit', 'Rate Limit Warning', '\`\`\`json\n{\n  "components": { "schemas": { "giant": true } } }\n\`\`\`', 'now', '{}'),
      ('pf_oversized', '${pageId}', '${snapshotId}', 'gotcha', 'Oversized Gotcha', '${'X'.repeat(3000)}', 'now', '{}');
  `);

  // Trigger migration / sanitization
  (db as any).migrate();

  const openapiPitfall = rawDb.prepare("SELECT * FROM pitfalls WHERE id = 'pf_openapi_dump'").get();
  assert.strictEqual(openapiPitfall, undefined); // Successfully deleted!

  const oversized = rawDb.prepare("SELECT length(content) as len, content FROM pitfalls WHERE id = 'pf_oversized'").get() as { len: number; content: string };
  assert.ok(oversized.len <= 1520);
  assert.ok(oversized.content.endsWith('... [truncated]'));

  db.close();
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StreamableHttpTransport } from '../../src/mcp/transports/http.ts';

test('MCP Version: Default McpServer version matches DOCORBIT_VERSION', () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  const server = new McpServer({
    repo,
    resolver: {} as any,
    serverName: 'docorbit-mcp',
  });

  assert.strictEqual(server.serverVersion, DOCORBIT_VERSION);
  assert.ok(/^\d+\.\d+\.\d+/.test(DOCORBIT_VERSION));

  db.close();
});

test('MCP Version: Consistent version across package metadata, McpServer, and HTTP transport', async () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'));
  assert.strictEqual(pkg.version, DOCORBIT_VERSION);

  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  const server = new McpServer({
    repo,
    serverName: 'docorbit-mcp',
  });
  assert.strictEqual(server.serverVersion, DOCORBIT_VERSION);

  const httpTransport = new StreamableHttpTransport();
  (httpTransport as any).mcpServer = server;

  let responseData = '';
  const mockReq: any = {
    method: 'GET',
    url: '/health',
    headers: {},
  };
  const mockRes: any = {
    writeHead: () => {},
    setHeader: () => {},
    end: (chunk: string) => { responseData = chunk; },
  };

  await httpTransport.dispatch(mockReq, mockRes);
  const parsed = JSON.parse(responseData);
  assert.strictEqual(parsed.version, DOCORBIT_VERSION);
  assert.strictEqual(parsed.server, 'docorbit-mcp');

  db.close();
});
