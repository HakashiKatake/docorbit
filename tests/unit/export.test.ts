import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import { ExportService } from '../../packages/export/src/index.ts';
import type {
  NormalizedPage,
  ApiEndpoint,
  Pitfall,
  IndexedExample,
  DiscoveredSource,
} from '../../packages/shared/src/index.ts';

function setupExportTestDb(): { db: DocOrbitDb; repo: DocOrbitRepository; service: ExportService } {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  // Seed source
  const source: DiscoveredSource = {
    id: 'src_nextjs',
    url: 'https://nextjs.org/docs',
    type: 'web',
    discoveredBy: 'direct',
    authority: 'official',
    confidence: 1.0,
    status: 'valid',
    machineReadable: true,
  };
  const sourceId = repo.saveSource(source);

  // Seed v14 page
  const page14: NormalizedPage = {
    id: 'page_v14',
    sourceId: sourceId,
    snapshotId: 'snap_v14',
    url: 'https://nextjs.org/docs/v14/routing',
    title: 'Next.js 14 Routing and Parameters',
    content: 'In Next.js 14, page props receive params synchronously: { params: { slug } }.',
    contentHash: 'hash_v14',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 2048,
    estimatedTokens: 250,
    headings: ['Dynamic Route Parameters', 'Client Components'],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: {
      sourceUrl: 'https://nextjs.org/docs/v14/routing',
      sourceAuthority: 'official',
      versionTag: 'v14',
    },
  };
  repo.savePage(page14);

  // Seed v15 page
  const page15: NormalizedPage = {
    id: 'page_v15',
    sourceId: sourceId,
    snapshotId: 'snap_v15',
    url: 'https://nextjs.org/docs/v15/routing',
    title: 'Next.js 15 Async Dynamic Route Parameters',
    content: 'In Next.js 15, route parameters are asynchronous promises: const { slug } = await params.',
    contentHash: 'hash_v15',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 2400,
    estimatedTokens: 310,
    headings: ['Asynchronous Request Headers and Params', 'Breaking Change Notice'],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: {
      sourceUrl: 'https://nextjs.org/docs/v15/routing',
      sourceAuthority: 'official',
      versionTag: 'v15',
    },
  };
  repo.savePage(page15);

  // Seed endpoints: v14 charge endpoint and v15 payment endpoint
  const ep14: ApiEndpoint = {
    id: 'ep_charge',
    sourceId: sourceId,
    pageId: page14.id,
    snapshotId: 'snap_v14',
    method: 'post',
    path: '/v1/charges',
    summary: 'Create a direct charge (legacy in v15)',
    parameters: [
      { name: 'amount', in: 'body', required: true, type: 'integer' },
      { name: 'currency', in: 'body', required: true, type: 'string' },
    ],
    deprecated: false,
    docVersion: 'v14',
    provenance: page14.provenance!,
  };

  const ep15: ApiEndpoint = {
    id: 'ep_payment_intents',
    sourceId: sourceId,
    pageId: page15.id,
    snapshotId: 'snap_v15',
    method: 'post',
    path: '/v1/payment_intents',
    summary: 'Create payment intent (modern standard)',
    parameters: [
      { name: 'amount', in: 'body', required: true, type: 'integer' },
      { name: 'currency', in: 'body', required: true, type: 'string' },
      { name: 'payment_method_types', in: 'body', required: false, type: 'array' },
    ],
    deprecated: false,
    docVersion: 'v15',
    provenance: page15.provenance!,
  };
  repo.saveApiEndpoints([ep14, ep15]);

  // Seed pitfalls
  const pitfall14: Pitfall = {
    id: 'pit_sync_params',
    pageId: page14.id,
    kind: 'breaking_change',
    severity: 'warning',
    title: 'Next.js 14 Synchronous Params Access',
    message: 'Params can be accessed directly without await in Next.js 14.',
    docVersion: 'v14',
    provenance: page14.provenance!,
  };

  const pitfall15: Pitfall = {
    id: 'pit_async_params',
    pageId: page15.id,
    kind: 'breaking_change',
    severity: 'error',
    title: 'Next.js 15 Async Route Parameters',
    message: 'Route handler params is a Promise in Next.js 15. Direct property access throws runtime error.',
    mitigation: 'Use: const { slug } = await params;',
    docVersion: 'v15',
    provenance: page15.provenance!,
  };
  repo.savePitfalls([pitfall14, pitfall15]);

  const service = new ExportService(repo);
  return { db, repo, service };
}

test('Export: AGENTS.md generation is strictly grounded and deterministic', async () => {
  const { db, service } = setupExportTestDb();
  try {
    const res1 = await service.generateExport({ format: 'agents.md' });
    const res2 = await service.generateExport({ format: 'agents.md' });

    assert.strictEqual(res1.content, res2.content, 'Repeated exports must be bit-for-bit identical');
    assert.strictEqual(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(res1.content), false, 'Generated AGENTS.md must not contain runtime timestamps');
    assert.ok(res1.content.includes('# AGENTS.md — Documentation & Version Intelligence Context'));
    assert.ok(res1.content.includes('Core API Contracts & Signatures'));
    assert.ok(res1.content.includes('/v1/charges'));
    assert.ok(res1.content.includes('/v1/payment_intents'));
    assert.ok(res1.content.includes('Critical Pitfalls & Breaking Changes'));
    assert.ok(res1.content.includes('Next.js 15 Async Route Parameters'));
    assert.strictEqual(res1.metadata.untrusted, true);
  } finally {
    db.close();
  }
});

test('Export: CLAUDE.md generates version-aware developer rules and verification commands', async () => {
  const { db, service } = setupExportTestDb();
  try {
    const res = await service.generateExport({ format: 'claude.md' });
    assert.ok(res.content.includes('# CLAUDE.md — Agent Working Rules & Documentation Contracts'));
    assert.ok(res.content.includes('docorbit verify'));
    assert.ok(res.content.includes('docorbit diff'));
    assert.ok(res.content.includes('docorbit impact'));
    assert.ok(res.content.includes('**NEVER**: Next.js 15 Async Route Parameters'));
    assert.strictEqual(res.metadata.untrusted, true);
  } finally {
    db.close();
  }
});

test('Export: skill.md includes YAML frontmatter, strict grounding, and schemas', async () => {
  const { db, service } = setupExportTestDb();
  try {
    const res = await service.generateExport({ format: 'skill.md', targetSource: 'nextjs-skill' });
    assert.ok(res.content.startsWith('---'));
    assert.ok(res.content.includes('name: nextjs-skill'));
    assert.ok(res.content.includes('grounding: strict_evidence'));
    assert.ok(res.content.includes('untrusted_documentation: true'));
    assert.ok(res.content.includes('# Skill: nextjs-skill'));
    assert.ok(res.content.includes('POST /v1/payment_intents'));
  } finally {
    db.close();
  }
});

test('Export: llms.txt generates standardized documentation hierarchy', async () => {
  const { db, service } = setupExportTestDb();
  try {
    const res = await service.generateExport({ format: 'llms.txt', targetSource: 'Next.js' });
    assert.ok(res.content.includes('# Next.js'));
    assert.ok(res.content.includes('## Documentation Pages'));
    assert.ok(res.content.includes('[Next.js 14 Routing and Parameters]'));
    assert.ok(res.content.includes('[Next.js 15 Async Dynamic Route Parameters]'));
    assert.ok(res.content.includes('## API Reference'));
  } finally {
    db.close();
  }
});

test('Export: docs-map.md produces hierarchical token footprints and chunk tree', async () => {
  const { db, service } = setupExportTestDb();
  try {
    const map = service.getDocumentationMap();
    assert.strictEqual(map.totalSources, 1);
    assert.strictEqual(map.totalPages, 2);
    assert.ok(map.totalEstimatedTokens >= 500);
    assert.ok(map.markdownTree.includes('Documentation Map & Token Footprint'));
    assert.ok(map.markdownTree.includes('Source: `https://nextjs.org/docs`'));
    assert.strictEqual(map.untrusted, true);
  } finally {
    db.close();
  }
});

test('Export: Version Correctness — changing docVersion actually changes generated export', async () => {
  const { db, service } = setupExportTestDb();
  try {
    const v14Export = await service.generateExport({ format: 'agents.md', docVersion: 'v14' });
    const v15Export = await service.generateExport({ format: 'agents.md', docVersion: 'v15' });

    // In v14 export:
    assert.ok(v14Export.content.includes('/v1/charges'), 'v14 export must include /v1/charges');
    assert.ok(!v14Export.content.includes('/v1/payment_intents'), 'v14 export must NOT include v15 endpoint /v1/payment_intents');
    assert.ok(v14Export.content.includes('Next.js 14 Synchronous Params Access'), 'v14 must include v14 pitfall');
    assert.ok(!v14Export.content.includes('Next.js 15 Async Route Parameters'), 'v14 must NOT include v15 pitfall');

    // In v15 export:
    assert.ok(v15Export.content.includes('/v1/payment_intents'), 'v15 export must include /v1/payment_intents');
    assert.ok(!v15Export.content.includes('/v1/charges'), 'v15 export must NOT include v14 endpoint /v1/charges');
    assert.ok(v15Export.content.includes('Next.js 15 Async Route Parameters'), 'v15 must include v15 pitfall');
    assert.ok(!v15Export.content.includes('Next.js 14 Synchronous Params Access'), 'v15 must NOT include v14 pitfall');

    // Contents must be distinct
    assert.notStrictEqual(v14Export.content, v15Export.content);
  } finally {
    db.close();
  }
});

test('Export: writeExport saves file to disk and creates missing parent directories', async () => {
  const { db, service } = setupExportTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docorbit-export-test-'));
  const targetFile = path.join(tmpDir, 'nested', 'subdir', 'AGENTS.md');

  try {
    const res = await service.writeExport({
      format: 'agents.md',
      outputPath: targetFile,
    });

    assert.ok(fs.existsSync(targetFile), 'Exported file must exist on disk');
    assert.strictEqual(res.outputPath, targetFile);
    const diskContent = fs.readFileSync(targetFile, 'utf-8');
    assert.strictEqual(diskContent, res.content);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    db.close();
  }
});

test('Export: Handles empty database gracefully without throwing', async () => {
  const emptyDb = new DocOrbitDb(':memory:');
  const emptyRepo = new DocOrbitRepository(emptyDb);
  const emptyService = new ExportService(emptyRepo);

  try {
    const res = await emptyService.generateExport({ format: 'agents.md' });
    assert.ok(res.content.includes('# AGENTS.md'));
    assert.ok(res.content.includes('No sources indexed'));
    assert.strictEqual(res.metadata.totalApis, 0);
    assert.strictEqual(res.metadata.totalPitfalls, 0);
  } finally {
    emptyDb.close();
  }
});
