import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocOrbitDb, DocOrbitRepository } from '../../src/storage/index.ts';
import { McpServer } from '../../src/mcp/server.ts';
import { DEFAULT_MAX_TOOL_OUTPUT_CHARS } from '../../src/mcp/tools/types.ts';

test('MCP Safety: All 15 MCP tools emit strictly bounded responses in Markdown and JSON modes', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'docorbit-safety-test-'));
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  try {

  // Seed source, snapshot, page with huge content (500k chars)
  const sourceId = repo.saveSource({
    url: 'https://safety-audit.example.com',
    type: 'web',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: true,
  });

  const snapshotId = repo.createSnapshot(sourceId, {
    targetUrl: 'https://safety-audit.example.com',
    pageCount: 1,
    ingestedAt: new Date().toISOString(),
  });

  const hugeText = 'SAFETY_VERIFICATION_PAYLOAD '.repeat(20_000); // ~560,000 characters
  const pageId = 'page_safety_audit';

  repo.savePage({
    id: pageId,
    sourceId,
    snapshotId,
    url: 'https://safety-audit.example.com/guide',
    title: 'Huge Safety Guide',
    content: hugeText,
    contentHash: 'hash_huge_safety',
    fetchedAt: new Date().toISOString(),
    rawBytes: hugeText.length,
    estimatedTokens: 140_000,
    headings: [{ level: 1, text: 'Huge Safety Guide', anchor: 'guide' }],
    links: [],
    codeExamples: [
      {
        id: 'ex_huge_1',
        language: 'typescript',
        code: 'const x = "' + 'E'.repeat(100_000) + '";',
        task: 'Huge Example Task',
      },
    ],
    securityAnnotations: [],
    provenance: { sourceUrl: 'https://safety-audit.example.com/guide', retrievedAt: new Date().toISOString(), sourceAuthority: 'official' },
  });

  repo.saveChunks([
    {
      id: 'chk_safety_1',
      pageId,
      chunkType: 'guide',
      title: 'Safety Section',
      sectionPath: ['Huge Safety Guide', 'Safety Section'],
      content: hugeText.slice(0, 100_000),
      tokenEstimate: 25_000,
      charLength: 100_000,
      headingLevel: 2,
      orderIndex: 0,
      symbols: ['safetyCheck'],
      contentHash: 'hash_chunk_safety',
    },
  ]);

  repo.savePitfalls([
    {
      id: 'pf_safety_1',
      pageId,
      snapshotId,
      kind: 'gotcha',
      title: 'Safety Pitfall Warning',
      content: hugeText.slice(0, 80_000),
      createdAt: new Date().toISOString(),
      provenance: { sourceUrl: 'https://safety-audit.example.com/guide', retrievedAt: new Date().toISOString(), sourceAuthority: 'official' },
    },
  ]);

  repo.saveApiEndpoints([
    {
      id: 'ep_safety_1',
      sourceId,
      pageId,
      snapshotId,
      path: '/v1/safety_endpoint',
      method: 'post',
      summary: 'Endpoint with very large summary ' + 'S'.repeat(10_000),
      parameters: Array.from({ length: 50 }, (_, i) => ({
        name: `param_${i}`,
        in: 'body' as const,
        required: i % 2 === 0,
        type: 'string',
        description: 'Parameter description ' + i,
      })),
      responses: [{ statusCode: 200, description: 'Success' }],
      auth: [{ type: 'bearer' }],
      pagination: { type: 'cursor', parameters: ['starting_after', 'limit'] },
    },
  ]);

  const server = new McpServer({ repo, serverName: 'docorbit-mcp', projectDir: tempDir });

  // Define invocation arguments for each of the 15 tools
  const toolsToTest: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: 'search_docs', args: { query: 'safety' } },
    { name: 'get_doc', args: { pageId } },
    { name: 'find_api', args: { query: 'safety' } },
    { name: 'find_example', args: { query: 'safety' } },
    { name: 'find_pitfall', args: { query: 'safety' } },
    { name: 'find_recipe', args: { goal: 'run safety check' } },
    { name: 'get_version', args: { library: 'nonexistent' } },
    { name: 'list_sources', args: {} },
    { name: 'get_implementation_context', args: { task: 'run safety check' } },
    { name: 'check_api', args: { code: 'const x = 1;' } },
    { name: 'diff_docs', args: {} },
    { name: 'analyze_impact', args: {} },
    { name: 'get_documentation_map', args: {} },
    { name: 'export_agent_context', args: { format: 'skill.md' } },
    { name: 'ingest_doc', args: { content: '# Ingest Safety Test\nContent', title: 'Ingest Safety Test' } },
  ];

  for (const toolDef of toolsToTest) {
    // 1. Markdown mode
    const mdRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 100000),
      method: 'tools/call',
      params: {
        name: toolDef.name,
        arguments: toolDef.args,
      },
    });

    assert.strictEqual(mdRes?.jsonrpc, '2.0');
    assert.ok(mdRes.result, `Tool ${toolDef.name} in Markdown mode must return a result`);
    const mdText = (mdRes.result as any).content[0].text;
    assert.ok(
      mdText.length <= DEFAULT_MAX_TOOL_OUTPUT_CHARS,
      `Tool "${toolDef.name}" output length ${mdText.length} exceeded ceiling ${DEFAULT_MAX_TOOL_OUTPUT_CHARS}`
    );

    // 2. JSON mode
    const jsonRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 100000),
      method: 'tools/call',
      params: {
        name: toolDef.name,
        arguments: { ...toolDef.args, format: 'json' },
      },
    });

    assert.strictEqual(jsonRes?.jsonrpc, '2.0');
    assert.ok(jsonRes.result, `Tool ${toolDef.name} in JSON mode must return a result`);
    const jsonText = (jsonRes.result as any).content[0].text;
    assert.ok(
      jsonText.length <= DEFAULT_MAX_TOOL_OUTPUT_CHARS,
      `Tool "${toolDef.name}" output length ${jsonText.length} exceeded ceiling ${DEFAULT_MAX_TOOL_OUTPUT_CHARS}`
    );

    // Validate valid JSON parsing
    let parsed: any;
    assert.doesNotThrow(
      () => { parsed = JSON.parse(jsonText); },
      `Tool "${toolDef.name}" output in JSON mode must be valid JSON`
    );
    assert.ok(parsed, `Parsed JSON for "${toolDef.name}" must not be empty`);
  }
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
