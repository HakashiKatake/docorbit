import test from 'node:test';
import assert from 'node:assert';
import { extractPitfalls } from '../../packages/normalizer/src/pitfall-extractor.ts';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import type { NormalizedPage, DocumentChunk } from '../../packages/shared/src/index.ts';

test('Pitfalls: extractPitfalls extracts admonitions and explicit warnings', () => {
  const page: NormalizedPage = {
    id: 'page_pit',
    sourceId: 'src_pit',
    snapshotId: 'snap_pit',
    url: 'https://example.com/docs/next',
    title: 'Next.js Server Actions and Secrets',
    content: 'Documentation content',
    contentHash: 'hash_pit',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 2048,
    estimatedTokens: 300,
    headings: [],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: {
      sourceUrl: 'https://example.com/docs/next',
      retrievedAt: '2026-09-06T12:00:00Z',
      sourceAuthority: 'official',
    },
  };

  const chunks: DocumentChunk[] = [
    {
      id: 'chunk_server_only',
      pageId: 'page_pit',
      snapshotId: 'snap_pit',
      title: 'Server Actions Security',
      sectionPath: ['Security', 'Server Actions'],
      content: `> [!WARNING]
> Never expose your secret key in client code. Server Actions can only be called from the server and must not import private database credentials on client components.`,
      chunkType: 'warning',
      tokenEstimate: 50,
      ordinal: 0,
      contentHash: 'h_w1',
      provenance: page.provenance,
    },
    {
      id: 'chunk_dep',
      pageId: 'page_pit',
      snapshotId: 'snap_pit',
      title: 'Legacy API Routes',
      sectionPath: ['API Routes', 'Deprecated Handlers'],
      content: `This method is deprecated; use Route Handlers instead.
Breaking change: Pages router API routes will be removed in version 16.`,
      chunkType: 'prose',
      tokenEstimate: 40,
      ordinal: 1,
      contentHash: 'h_w2',
      provenance: page.provenance,
    },
    {
      id: 'chunk_rate_limit',
      pageId: 'page_pit',
      snapshotId: 'snap_pit',
      title: 'Rate Limits',
      sectionPath: ['API', 'Rate Limits'],
      content: `Requests are throttled at 100 requests per minute. Exceeding this returns HTTP 429 Too Many Requests.`,
      chunkType: 'prose',
      tokenEstimate: 30,
      ordinal: 2,
      contentHash: 'h_w3',
      provenance: page.provenance,
    },
    {
      id: 'chunk_benign',
      pageId: 'page_pit',
      snapshotId: 'snap_pit',
      title: 'Introduction',
      sectionPath: ['Getting Started'],
      content: `DocOrbit helps AI agents navigate documentation with ease. Notice how simple and fast the setup is.`,
      chunkType: 'prose',
      tokenEstimate: 25,
      ordinal: 3,
      contentHash: 'h_w4',
      provenance: page.provenance,
    },
  ];

  const pitfalls = extractPitfalls(page, chunks, 'v14');

  // Verify false positive resistance: benign text doesn't produce pitfalls
  assert.ok(!pitfalls.some(p => p.content.includes('Notice how simple and fast')));

  // Verify server_only / security pitfall
  const serverOnly = pitfalls.find(p => p.kind === 'server_only' || p.kind === 'breaking_change');
  assert.ok(serverOnly);
  assert.ok(serverOnly.content.includes('Never expose your secret key'));

  // Verify deprecated pitfall
  const dep = pitfalls.find(p => p.kind === 'deprecated');
  assert.ok(dep);
  assert.ok(dep.content.includes('This method is deprecated'));

  // Verify breaking change pitfall
  const breaking = pitfalls.find(p => p.kind === 'breaking_change' || p.kind === 'removed');
  assert.ok(breaking);
  assert.ok(breaking.content.includes('Breaking change'));

  // Verify rate limit pitfall
  const rateLimit = pitfalls.find(p => p.kind === 'rate_limit');
  assert.ok(rateLimit);
  assert.ok(rateLimit.content.includes('429 Too Many Requests'));
});

test('Pitfalls: SQLite Repository stores and queries pitfalls by kind', () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  const page: NormalizedPage = {
    id: 'page_db_pf',
    sourceId: 'src_db_pf',
    snapshotId: 'snap_db_pf',
    url: 'https://example.com/docs/pitfalls',
    title: 'Pitfall Docs',
    content: '',
    contentHash: 'h_pf',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 100,
    estimatedTokens: 20,
    headings: [],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: {
      sourceUrl: 'https://example.com/docs/pitfalls',
      retrievedAt: '2026-09-06T12:00:00Z',
      sourceAuthority: 'official',
    },
  };

  const sourceId = repo.saveSource({
    url: page.url,
    type: 'web',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: false,
  });
  page.sourceId = sourceId;
  repo.savePage(page);

  repo.savePitfalls([
    {
      id: 'pf_dep_1',
      pageId: page.id,
      snapshotId: page.snapshotId,
      kind: 'deprecated',
      title: 'Deprecated Params in Next.js 15',
      content: 'Synchronous route params are deprecated in Next.js 15 and will be removed in Next.js 16.',
      docVersion: 'v15',
      createdAt: '2026-09-06T12:00:00Z',
    },
    {
      id: 'pf_sec_1',
      pageId: page.id,
      snapshotId: page.snapshotId,
      kind: 'security',
      title: 'Webhook Replay Attacks',
      content: 'Always verify timestamp tolerance to prevent webhook replay attacks.',
      docVersion: 'v1',
      createdAt: '2026-09-06T12:00:00Z',
    },
  ]);

  const depHits = repo.searchPitfalls('route params', { kind: 'deprecated' });
  assert.strictEqual(depHits.length, 1);
  assert.strictEqual(depHits[0].kind, 'deprecated');
  assert.strictEqual(depHits[0].docVersion, 'v15');

  const secHits = repo.searchPitfalls('replay attacks', { kind: 'security' });
  assert.strictEqual(secHits.length, 1);
  assert.strictEqual(secHits[0].kind, 'security');

  db.close();
});
