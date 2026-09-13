import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocOrbitDb, DocOrbitRepository } from '../../src/storage/index.ts';
import { McpServer } from '../../src/mcp/index.ts';
import { SourceManagementService } from '../../src/core/index.ts';
import { readDocsLock } from '../../src/workspace/index.ts';

test('CLI and MCP Parity: Shared source management and idempotency across interfaces', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'docorbit-parity-'));
  const dbPath = join(dir, '.docorbit', 'docorbit.db');
  const db = new DocOrbitDb(dbPath);
  const repo = new DocOrbitRepository(db);

  // Initialize a mock package.json
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'test-parity-project', dependencies: { next: '^14.0.0' } }, null, 2),
    'utf-8'
  );

  const server = new McpServer({
    repo,
    projectDir: dir,
  });

  try {
    const sm = new SourceManagementService(repo, { projectDir: dir });

    // Step 1: Add documentation source via CLI service layer
    const cliResult1 = await sm.addOrTrackSource({
      url: 'https://docs.github.com/en',
      content: '# GitHub REST API\nEndpoints for repository and workflow management.\n',
      title: 'GitHub REST API Docs',
      projectDir: dir,
    });

    assert.strictEqual(cliResult1.status, 'added');
    assert.strictEqual(cliResult1.url, 'https://docs.github.com/en');
    assert.ok(cliResult1.snapshotId);

    // Verify docs.lock was created and contains the standalone source
    const lock1 = readDocsLock(dir);
    assert.ok(lock1);
    assert.strictEqual(lock1.sources?.length, 1);
    assert.strictEqual(lock1.sources[0].url, 'https://docs.github.com/en');
    assert.strictEqual(lock1.sources[0].status, 'ingested');
    assert.strictEqual(lock1.sources[0].snapshotId, cliResult1.snapshotId);

    // Step 2: Repeat call via CLI with different representation (trailing slash)
    const cliResult2 = await sm.addOrTrackSource({
      url: 'https://docs.github.com/en/',
      projectDir: dir,
    });

    assert.strictEqual(cliResult2.status, 'already_tracked');
    assert.strictEqual(cliResult2.url, 'https://docs.github.com/en');
    assert.strictEqual(cliResult2.snapshotId, cliResult1.snapshotId);

    // Step 3: Run equivalent operation through MCP ingest_doc tool with uppercase + tracking params
    const mcpResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'ingest_doc',
        arguments: {
          url: 'HTTPS://DOCS.GITHUB.COM/en?utm_source=slack&utm_medium=chat',
          format: 'json',
        },
      },
    });

    assert.ok(mcpResponse && mcpResponse.result);
    const mcpResult = mcpResponse.result as { isError?: boolean; content: Array<{ text: string }> };
    assert.strictEqual(mcpResult.isError, undefined);

    const parsedMcp = JSON.parse(mcpResult.content[0].text);
    assert.strictEqual(parsedMcp.data.status, 'already_tracked');
    assert.strictEqual(parsedMcp.data.targetUrl, 'https://docs.github.com/en');
    assert.strictEqual(parsedMcp.data.snapshotId, cliResult1.snapshotId);

    // Step 4: Verify single source in SQLite and docs.lock
    const allDbSources = repo.listSources();
    assert.strictEqual(allDbSources.length, 1);
    assert.strictEqual(allDbSources[0].url, 'https://docs.github.com/en');

    const lockFinal = readDocsLock(dir);
    assert.ok(lockFinal);
    assert.strictEqual(lockFinal.sources?.length, 1);
    assert.strictEqual(lockFinal.sources[0].url, 'https://docs.github.com/en');
    assert.strictEqual(lockFinal.sources[0].snapshotId, cliResult1.snapshotId);

    // Step 5: Force refresh via MCP updates snapshot
    const mcpForceResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/call',
      params: {
        name: 'ingest_doc',
        arguments: {
          url: 'https://docs.github.com/en',
          content: '# GitHub REST API v2\nUpdated API with new endpoints.\n',
          force: true,
          format: 'json',
        },
      },
    });

    assert.ok(mcpForceResponse && mcpForceResponse.result);
    const parsedForce = JSON.parse((mcpForceResponse.result as any).content[0].text);
    assert.strictEqual(parsedForce.data.status, 'updated');

    const lockAfterForce = readDocsLock(dir);
    assert.strictEqual(lockAfterForce?.sources?.length, 1);
    assert.strictEqual(lockAfterForce?.sources[0].snapshotId, parsedForce.data.snapshotId);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
