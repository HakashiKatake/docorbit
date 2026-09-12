import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import { McpServer } from '../../packages/mcp/src/index.ts';
import { DashboardServer } from '../../packages/core/src/index.ts';
import { ExportService } from '../../packages/export/src/index.ts';
import { runExportCommand } from '../../apps/cli/src/commands/export.ts';
import type { DiscoveredSource, NormalizedPage, ApiEndpoint, Pitfall } from '../../packages/shared/src/index.ts';

function setupE2eDb(dbPath: string): { db: DocOrbitDb; repo: DocOrbitRepository } {
  const db = new DocOrbitDb(dbPath);
  const repo = new DocOrbitRepository(db);

  const src: DiscoveredSource = {
    id: 'src_e2e',
    url: 'https://docs.stripe.com/api',
    type: 'openapi',
    discoveredBy: 'direct',
    authority: 'official',
    confidence: 1.0,
    status: 'valid',
    machineReadable: true,
  };
  const sourceId = repo.saveSource(src);

  repo.savePage({
    id: 'page_e2e_wh',
    sourceId,
    snapshotId: 'snap_e2e',
    url: 'https://docs.stripe.com/webhooks',
    title: 'Stripe Webhook Signatures',
    content: 'Always use raw body for constructEvent.',
    contentHash: 'hash_e2e',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 1000,
    estimatedTokens: 180,
    headings: ['Signature Verification'],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: { sourceUrl: src.url, sourceAuthority: 'official', versionTag: 'v14' },
  });

  const ep: ApiEndpoint = {
    id: 'ep_e2e_wh',
    sourceId,
    pageId: 'page_e2e_wh',
    snapshotId: 'snap_e2e',
    method: 'post',
    path: '/v1/webhook_endpoints',
    summary: 'Create webhook endpoint',
    parameters: [{ name: 'url', in: 'body', required: true, type: 'string' }],
    deprecated: false,
    docVersion: 'v14',
    provenance: { sourceUrl: src.url, sourceAuthority: 'official', versionTag: 'v14' },
  };
  repo.saveApiEndpoints([ep]);

  const pf: Pitfall = {
    id: 'pit_e2e_raw',
    pageId: 'page_e2e_wh',
    kind: 'server_only',
    severity: 'error',
    title: 'Raw Body Buffer Required',
    message: 'ConstructEvent requires the raw request buffer to verify HMAC signature.',
    mitigation: 'Use req.text() instead of req.json()',
    docVersion: 'v14',
    provenance: { sourceUrl: src.url, sourceAuthority: 'official', versionTag: 'v14' },
  };
  repo.savePitfalls([pf]);

  return { db, repo };
}

test('Integration E2E: CLI Export and MCP Agent Context Tools', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docorbit-e2e-m7-'));
  const dbPath = path.join(tmpDir, 'docorbit.db');
  const { db, repo } = setupE2eDb(dbPath);

  try {
    // 1. Test CLI export writing to custom output path
    const targetFile = path.join(tmpDir, 'AGENTS.md');
    await runExportCommand('agents.md', {
      output: targetFile,
      dbPath,
    });

    assert.ok(fs.existsSync(targetFile), 'CLI export should write AGENTS.md');
    const content = fs.readFileSync(targetFile, 'utf-8');
    assert.ok(content.includes('# AGENTS.md — Documentation & Version Intelligence Context'));
    assert.ok(content.includes('/v1/webhook_endpoints'));
    assert.ok(content.includes('Raw Body Buffer Required'));

    // 2. Test MCP tool: get_documentation_map
    const server = new McpServer({ repo });
    const mapRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'get_documentation_map',
        arguments: {},
      },
    });

    assert.ok(mapRes && mapRes.result);
    const mapContent = (mapRes.result as any).content[0].text;
    assert.ok(!mapContent.startsWith('{'), 'Should return direct markdown tree');
    assert.ok(mapContent.includes('Documentation Map'));

    // Also verify get_documentation_map with format: 'json'
    const mapJsonRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 1011,
      method: 'tools/call',
      params: {
        name: 'get_documentation_map',
        arguments: { format: 'json' },
      },
    });
    const mapParsed = JSON.parse((mapJsonRes!.result as any).content[0].text);
    assert.strictEqual(mapParsed.data.totalSources, 1);
    assert.strictEqual(mapParsed.data.totalPages, 1);
    assert.strictEqual(mapParsed.data.untrusted, true);

    // 3. Test MCP tool: export_agent_context (CLAUDE.md)
    const exportRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/call',
      params: {
        name: 'export_agent_context',
        arguments: {
          format: 'claude.md',
          docVersion: 'v14',
        },
      },
    });

    assert.ok(exportRes && exportRes.result);
    const expText = (exportRes.result as any).content[0].text;
    assert.ok(!expText.startsWith('{'), 'Should return raw CLAUDE.md markdown content directly');
    assert.ok(expText.includes('# CLAUDE.md — Agent Working Rules & Documentation Contracts'));
    assert.ok(expText.includes('docorbit verify'));
    assert.ok(expText.includes('Raw Body Buffer Required'));

    // 4. Test MCP tool: export_agent_context (skill.md)
    const skillRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 103,
      method: 'tools/call',
      params: {
        name: 'export_agent_context',
        arguments: {
          format: 'skill.md',
        },
      },
    });

    assert.ok(skillRes && skillRes.result);
    const skillText = (skillRes.result as any).content[0].text;
    assert.ok(!skillText.startsWith('{'), 'Should return raw skill.md markdown directly');
    assert.ok(skillText.startsWith('---'));
    assert.ok(skillText.includes('untrusted_documentation: true'));
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
