import test from 'node:test';
import assert from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
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

test('MCP Stdio Lifecycle Regression: 1 MB, 10 MB, and 50 MB records do not kill MCP process', async () => {
  const dbPath = join(tmpdir(), `test-mcp-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  const db = new DocOrbitDb(dbPath);
  const repo = new DocOrbitRepository(db);

  const sourceId = repo.saveSource({
    url: 'https://api.huge-payload.example.com',
    type: 'openapi',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: true,
  });

  const snapshotId = repo.createSnapshot(sourceId, {
    targetUrl: 'https://api.huge-payload.example.com',
    pageCount: 3,
    ingestedAt: new Date().toISOString(),
  });

  const pageId = 'page_huge_lifecycle';
  repo.savePage({
    id: pageId,
    sourceId,
    snapshotId,
    url: 'https://api.huge-payload.example.com/docs',
    title: 'Huge Payload Documentation',
    content: 'Documentation page for testing lifecycle robustness',
    contentHash: 'hash_huge_lifecycle',
    fetchedAt: new Date().toISOString(),
    rawBytes: 100,
    estimatedTokens: 25,
    headings: [],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: { sourceUrl: 'https://api.huge-payload.example.com', retrievedAt: new Date().toISOString(), sourceAuthority: 'official' },
  });

  // Prepare 1 MB, 10 MB, and 50 MB payloads
  const payload1MB = 'RATE_LIMIT_WARNING_1MB ' + 'X'.repeat(1024 * 1024);
  const payload10MB = 'RATE_LIMIT_WARNING_10MB ' + 'Y'.repeat(10 * 1024 * 1024);
  const payload50MB = 'RATE_LIMIT_WARNING_50MB ' + 'Z'.repeat(50 * 1024 * 1024);

  // Directly insert the artificially massive pitfall records using raw SQLite
  const rawDb = db.getRawDb();
  rawDb.exec(`
    INSERT INTO pitfalls (id, page_id, snapshot_id, kind, title, content, created_at, provenance_json)
    VALUES
      ('pf_1mb', '${pageId}', '${snapshotId}', 'rate_limit', '1MB Pitfall Warning', '${payload1MB.replace(/'/g, "''")}', 'now', '{}'),
      ('pf_10mb', '${pageId}', '${snapshotId}', 'rate_limit', '10MB Pitfall Warning', '${payload10MB.replace(/'/g, "''")}', 'now', '{}'),
      ('pf_50mb', '${pageId}', '${snapshotId}', 'rate_limit', '50MB Pitfall Warning', '${payload50MB.replace(/'/g, "''")}', 'now', '{}');
  `);
  db.close();

  // Start the real DocOrbit MCP stdio server process pointing to this database
  const cliScript = resolve(process.cwd(), 'bin/docorbit.js');
  const proc = spawn('node', [cliScript, 'mcp', '--db', dbPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, DOCORBIT_MAX_TOOL_OUTPUT_CHARS: '60000' },
  });

  const client = createJsonRpcClient(proc);

  try {
    // 1. Initialize MCP connection
    const initRes = await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'lifecycle-test-runner', version: '1.0.0' },
    });

    assert.strictEqual(initRes.jsonrpc, '2.0');
    assert.strictEqual(initRes.result.serverInfo.name, 'docorbit-mcp');
    assert.strictEqual(initRes.result.serverInfo.version, DOCORBIT_VERSION);

    // 2. Test 1 MB record
    const res1MB = await client.send('tools/call', {
      name: 'find_pitfall',
      arguments: { query: '1MB' },
    });

    assert.strictEqual(res1MB.jsonrpc, '2.0');
    assert.ok(res1MB.result);
    assert.strictEqual(res1MB.result.content.length, 1);
    const text1MB = res1MB.result.content[0].text;
    assert.ok(text1MB.length <= DEFAULT_MAX_TOOL_OUTPUT_CHARS, `Expected length <= 60000, got ${text1MB.length}`);
    assert.strictEqual(proc.exitCode, null, 'MCP process must remain alive after 1MB query');

    // Immediately call second tool after 1MB query to verify server is fully functional
    const listRes1 = await client.send('tools/call', {
      name: 'list_sources',
      arguments: {},
    });
    assert.strictEqual(listRes1.jsonrpc, '2.0');
    assert.ok(listRes1.result.content[0].text.includes('Indexed Documentation Sources'));

    // 3. Test 10 MB record in JSON mode
    const res10MB = await client.send('tools/call', {
      name: 'find_pitfall',
      arguments: { query: '10MB', format: 'json' },
    });

    assert.strictEqual(res10MB.jsonrpc, '2.0');
    assert.ok(res10MB.result);
    const text10MB = res10MB.result.content[0].text;
    assert.ok(text10MB.length <= DEFAULT_MAX_TOOL_OUTPUT_CHARS, `Expected length <= 60000, got ${text10MB.length}`);
    // Must be valid JSON
    const parsed10MB = JSON.parse(text10MB);
    assert.ok(parsed10MB);
    assert.strictEqual(proc.exitCode, null, 'MCP process must remain alive after 10MB query');

    // Immediately call second tool after 10MB query
    const listRes2 = await client.send('tools/call', {
      name: 'get_version',
      arguments: { library: 'non_existent_lib' },
    });
    assert.strictEqual(listRes2.jsonrpc, '2.0');
    assert.ok(listRes2.result.content[0].text.includes('Version Resolution'));

    // 4. Test 50 MB record in Markdown mode
    const res50MB = await client.send('tools/call', {
      name: 'find_pitfall',
      arguments: { query: '50MB' },
    });

    assert.strictEqual(res50MB.jsonrpc, '2.0');
    assert.ok(res50MB.result);
    const text50MB = res50MB.result.content[0].text;
    assert.ok(text50MB.length <= DEFAULT_MAX_TOOL_OUTPUT_CHARS, `Expected length <= 60000, got ${text50MB.length}`);
    assert.strictEqual(proc.exitCode, null, 'MCP process must remain alive after 50MB query');

    // 5. Final assertion: subsequent tool call succeeds after 50MB query
    const toolsListRes = await client.send('tools/list', {});
    assert.strictEqual(toolsListRes.jsonrpc, '2.0');
    assert.strictEqual(toolsListRes.result.tools.length, 15);

  } finally {
    proc.kill('SIGTERM');
    if (existsSync(dbPath)) {
      try { unlinkSync(dbPath); } catch {}
    }
  }
});
