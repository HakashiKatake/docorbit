import test from 'node:test';
import assert from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import { buildNormalizedPage, extractPitfalls } from '../../packages/normalizer/src/index.ts';
import { DOCORBIT_VERSION } from '../../packages/shared/src/index.ts';
import { DEFAULT_MAX_TOOL_OUTPUT_CHARS } from '../../packages/mcp/src/tools/types.ts';

function createJsonRpcClient(proc: ChildProcess) {
  let buffer = '';
  const pending = new Map<number, (res: any) => void>();

  proc.stdout!.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.id !== undefined && pending.has(parsed.id)) {
          const resolver = pending.get(parsed.id)!;
          pending.delete(parsed.id);
          resolver(parsed);
        }
      } catch {}
    }
  });

  return {
    send(method: string, params?: Record<string, unknown>, id?: number): Promise<any> {
      const reqId = id ?? Math.floor(Math.random() * 1000000) + 1;
      return new Promise((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          pending.delete(reqId);
          rejectPromise(new Error(`Timeout waiting for JSON-RPC response to ${method} (id=${reqId})`));
        }, 15000);

        pending.set(reqId, (res) => {
          clearTimeout(timer);
          resolvePromise(res);
        });

        const msg = JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params }) + '\n';
        proc.stdin!.write(msg);
      });
    },
  };
}

test('Stripe Bug Regression: OpenAPI ingestion prevents enormous pitfall creation', () => {
  // 1. Build a synthetic Stripe-like OpenAPI spec (~2 MB)
  const paths: Record<string, any> = {};
  for (let i = 0; i < 500; i++) {
    paths[`/v1/stripe_resource_${i}`] = {
      post: {
        summary: `Create resource ${i}`,
        description: `Rate limit warning: Exceeding 100 req/s will return HTTP 429 Too Many Requests. Schema details: ${'A'.repeat(500)}`,
        responses: {
          '200': { description: 'Success' },
          '429': { description: 'Rate limit error' },
        },
      },
    };
  }

  const specObj = {
    openapi: '3.0.0',
    info: { title: 'Stripe API Mock', version: '2024-06-20' },
    servers: [{ url: 'https://api.stripe.com' }],
    paths,
  };
  const rawSpec = JSON.stringify(specObj, null, 2);

  const page = buildNormalizedPage({
    sourceId: 'src_stripe_test',
    url: 'https://api.stripe.com/spec3.json',
    rawContent: rawSpec,
    contentType: 'application/json',
    sourceUrl: 'https://api.stripe.com/spec3.json',
    targetUrl: 'https://api.stripe.com/spec3.json',
    title: 'Stripe API Mock Spec',
    discoveredBy: 'direct',
    fetchedAt: new Date().toISOString(),
  });

  // Verify buildNormalizedPage did NOT embed the entire 2MB JSON in markdown
  assert.ok(page.content.length < 50_000, `Page markdown length ${page.content.length} is expected to be compact (< 50,000)`);
  assert.ok(page.content.includes('API Endpoints'));

  // Verify extractPitfalls does NOT generate an oversized pitfall record
  const chunks = [
    {
      id: 'chk_spec_1',
      pageId: 'page_spec_1',
      chunkType: 'api_reference' as const,
      title: 'Spec Overview',
      sectionPath: ['API Overview'],
      content: page.content,
      tokenEstimate: 200,
      charLength: page.content.length,
      headingLevel: 1,
      orderIndex: 0,
      symbols: [],
      contentHash: 'hash1',
    },
  ];

  const pitfalls = extractPitfalls(page, chunks);
  for (const pf of pitfalls) {
    assert.ok(pf.content.length <= 1520, `Pitfall content length must be <= 1520, got ${pf.content.length}`);
  }
});

test('Migration & Server Lifecycle: legacy corrupted DB is sanitized and MCP succeeds', async () => {
  const dbPath = join(tmpdir(), `test-mcp-migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  const initialDb = new DocOrbitDb(dbPath);
  const repo = new DocOrbitRepository(initialDb);

  const sourceId = repo.saveSource({
    url: 'https://stripe.com/docs',
    type: 'openapi',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: true,
  });

  const snapshotId = repo.createSnapshot(sourceId, {
    targetUrl: 'https://stripe.com/docs',
    pageCount: 1,
    ingestedAt: new Date().toISOString(),
  });

  const pageId = 'page_stripe_legacy';
  repo.savePage({
    id: pageId,
    sourceId,
    snapshotId,
    url: 'https://stripe.com/docs/api',
    title: 'Stripe Legacy Page',
    content: 'Legacy documentation content',
    contentHash: 'hash_legacy_1',
    fetchedAt: new Date().toISOString(),
    rawBytes: 100,
    estimatedTokens: 25,
    headings: [],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: { sourceUrl: 'https://stripe.com/docs/api', retrievedAt: new Date().toISOString(), sourceAuthority: 'official' },
  });

  // Deliberately insert an 8 MB legacy corrupt pitfall resembling the Stripe Claude Code crash
  const legacyCorruptedContent = '{\n  "openapi": "3.0.0",\n  "components": {\n    "schemas": {\n      "RateLimit": "' + 'M'.repeat(8 * 1024 * 1024) + '"\n    }\n  }\n}';
  const legacyOversizedGotcha = 'DANGEROUS_GOTCHA '.repeat(300); // ~4800 chars

  const rawDb = initialDb.getRawDb();
  rawDb.exec(`
    INSERT INTO pitfalls (id, page_id, snapshot_id, kind, title, content, created_at, provenance_json)
    VALUES
      ('pf_stripe_openapi_dump', '${pageId}', '${snapshotId}', 'rate_limit', 'Rate Limit Warning', '${legacyCorruptedContent.replace(/'/g, "''")}', 'now', '{}'),
      ('pf_legacy_gotcha', '${pageId}', '${snapshotId}', 'gotcha', 'Oversized Gotcha', '${legacyOversizedGotcha.replace(/'/g, "''")}', 'now', '{}');
  `);
  initialDb.close();

  // Re-open via DocOrbitDb to trigger automatic migration on startup
  const migratedDb = new DocOrbitDb(dbPath);
  const migratedRawDb = migratedDb.getRawDb();

  // Verify OpenAPI dump is deleted
  const deletedPf = migratedRawDb.prepare("SELECT * FROM pitfalls WHERE id = 'pf_stripe_openapi_dump'").get();
  assert.strictEqual(deletedPf, undefined, 'Legacy OpenAPI dump must be deleted during migration');

  // Verify oversized gotcha is clamped to <= 1520 chars
  const clampedPf = migratedRawDb.prepare("SELECT length(content) as len, content FROM pitfalls WHERE id = 'pf_legacy_gotcha'").get() as { len: number; content: string };
  assert.ok(clampedPf.len <= 1520);
  assert.ok(clampedPf.content.endsWith('... [truncated]'));
  migratedDb.close();

  // Now boot the real MCP stdio server on this database
  const cliScript = resolve(process.cwd(), 'bin/docorbit.js');
  const proc = spawn('node', [cliScript, 'mcp', '--db', dbPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, DOCORBIT_MAX_TOOL_OUTPUT_CHARS: '60000' },
  });

  const client = createJsonRpcClient(proc);

  try {
    const initRes = await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'migration-test-runner', version: '1.0.0' },
    });
    assert.strictEqual(initRes.result.serverInfo.version, DOCORBIT_VERSION);

    // Call find_pitfall
    const pfRes = await client.send('tools/call', {
      name: 'find_pitfall',
      arguments: { query: 'gotcha' },
    });

    assert.strictEqual(pfRes.jsonrpc, '2.0');
    assert.ok(pfRes.result.content[0].text.length <= DEFAULT_MAX_TOOL_OUTPUT_CHARS);
    assert.strictEqual(proc.exitCode, null, 'Process must stay alive after find_pitfall query on migrated db');

    // Immediately call another tool
    const srcRes = await client.send('tools/call', {
      name: 'list_sources',
      arguments: {},
    });
    assert.strictEqual(srcRes.jsonrpc, '2.0');
    assert.ok(srcRes.result.content[0].text.includes('stripe.com'));
    assert.strictEqual(proc.exitCode, null);
  } finally {
    proc.kill('SIGTERM');
    if (existsSync(dbPath)) {
      try { unlinkSync(dbPath); } catch {}
    }
  }
});
