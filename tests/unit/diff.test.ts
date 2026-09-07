import test from 'node:test';
import assert from 'node:assert';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import { DocDiffEngine, DiffService } from '../../packages/verification/src/index.ts';
import type {
  ApiEndpoint,
  DiscoveredSource,
  DocumentChunk,
  NormalizedPage,
  Pitfall,
} from '../../packages/shared/src/index.ts';

function setupDiffDb(): { db: DocOrbitDb; repo: DocOrbitRepository } {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  // Source
  const src: DiscoveredSource = {
    id: 'src_test',
    url: 'https://docs.example.com',
    type: 'openapi',
    discoveredBy: 'manual',
    authority: 'official',
    confidence: 1.0,
    status: 'valid',
    machineReadable: true,
  };
  const sourceId = repo.saveSource(src);

  // Snapshot v1
  const snap1 = repo.createSnapshot(sourceId, { version: 'v1' }, 'v1');
  // Snapshot v2
  const snap2 = repo.createSnapshot(sourceId, { version: 'v2' }, 'v2');

  const page1: NormalizedPage = {
    id: 'page_v1',
    sourceId,
    title: 'V1 Docs',
    url: 'https://docs.example.com/v1',
    content: 'Version 1 documentation text.',
    contentHash: 'hash_v1',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 1000,
    estimatedTokens: 250,
    headings: [],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
  };
  repo.savePage(page1);

  // Endpoints v1
  const epV1: ApiEndpoint[] = [
    {
      id: 'ep_get_users_v1',
      pageId: page1.id,
      snapshotId: snap1,
      method: 'get',
      path: '/v1/users',
      summary: 'List users',
      parameters: [{ name: 'limit', in: 'query', required: false, type: 'integer', description: 'Limit' }],
      auth: [{ type: 'bearer' }],
      errors: [],
      deprecated: false,
      docVersion: 'v1',
      createdAt: '2026-09-06T12:00:00Z',
    },
    {
      id: 'ep_charges_v1',
      pageId: page1.id,
      snapshotId: snap1,
      method: 'post',
      path: '/v1/charges',
      summary: 'Create charge',
      parameters: [{ name: 'amount', in: 'query', required: true, type: 'integer', description: 'Amount' }],
      auth: [{ type: 'bearer' }],
      errors: [],
      deprecated: false,
      docVersion: 'v1',
      createdAt: '2026-09-06T12:00:00Z',
    },
  ];
  repo.saveApiEndpoints(epV1);

  // Endpoints v2
  const epV2: ApiEndpoint[] = [
    {
      id: 'ep_get_users_v2',
      pageId: page1.id,
      snapshotId: snap2,
      method: 'get',
      path: '/v1/users',
      summary: 'List users (updated with cursor pagination)',
      parameters: [
        { name: 'limit', in: 'query', required: false, type: 'integer', description: 'Limit' },
        { name: 'starting_after', in: 'query', required: false, type: 'string', description: 'Cursor' },
      ],
      auth: [{ type: 'bearer' }],
      errors: [],
      deprecated: false,
      docVersion: 'v2',
      createdAt: '2026-09-06T12:00:00Z',
    },
    {
      id: 'ep_payment_intents_v2',
      pageId: page1.id,
      snapshotId: snap2,
      method: 'post',
      path: '/v1/payment_intents',
      summary: 'Create a payment intent',
      parameters: [{ name: 'amount', in: 'query', required: true, type: 'integer', description: 'Amount' }],
      auth: [{ type: 'bearer' }],
      errors: [],
      deprecated: false,
      docVersion: 'v2',
      createdAt: '2026-09-06T12:00:00Z',
    },
  ];
  repo.saveApiEndpoints(epV2);

  // Pitfall in v2
  const pitfallV2: Pitfall[] = [
    {
      id: 'pit_charges_removed_v2',
      pageId: page1.id,
      snapshotId: snap2,
      kind: 'removed',
      title: 'Charges API Removed in v2',
      content: 'The /v1/charges endpoint has been permanently removed in v2.',
      relatedApi: '/v1/charges',
      docVersion: 'v2',
      createdAt: '2026-09-06T12:00:00Z',
    },
  ];
  repo.savePitfalls(pitfallV2);

  // Chunks in v1 and v2 with whitespace-only differences
  const chunkV1: DocumentChunk = {
    id: 'chk_intro_v1',
    pageId: page1.id,
    snapshotId: snap1,
    title: 'Introduction',
    content: 'Welcome to the API. Use this service to process payments.',
    contentHash: 'hash_intro_v1',
    chunkType: 'prose',
    tokenEstimate: 15,
    ordinal: 0,
    sectionPath: ['Introduction'],
    provenance: { sourceId, pageId: page1.id, url: page1.url, authority: 'official' },
    docVersion: 'v1',
  };
  const chunkV2: DocumentChunk = {
    id: 'chk_intro_v2',
    pageId: page1.id,
    snapshotId: snap2,
    title: 'Introduction',
    content: 'Welcome  to   the API.\nUse this service to process payments.  ',
    contentHash: 'hash_intro_v2',
    chunkType: 'prose',
    tokenEstimate: 15,
    ordinal: 0,
    sectionPath: ['Introduction'],
    provenance: { sourceId, pageId: page1.id, url: page1.url, authority: 'official' },
    docVersion: 'v2',
  };
  repo.saveChunks([chunkV1, chunkV2]);

  return { db, repo };
}

test('DocDiffEngine: detects added, removed, and modified endpoints accurately', () => {
  const { db, repo } = setupDiffDb();
  try {
    const engine = new DocDiffEngine(repo);
    const diff = engine.diff({
      fromVersion: 'v1',
      toVersion: 'v2',
    });

    assert.strictEqual(diff.summary.endpointsAdded, 1);
    assert.strictEqual(diff.summary.endpointsRemoved, 1);
    assert.strictEqual(diff.summary.endpointsModified, 1);

    // Added: POST /v1/payment_intents
    const added = diff.apiChanges.find(c => c.changeType === 'added');
    assert.ok(added);
    assert.strictEqual(added.path, '/v1/payment_intents');

    // Removed: POST /v1/charges
    const removed = diff.apiChanges.find(c => c.changeType === 'removed');
    assert.ok(removed);
    assert.strictEqual(removed.path, '/v1/charges');

    // Modified: GET /v1/users (added parameter starting_after)
    const modified = diff.apiChanges.find(c => c.changeType === 'modified');
    assert.ok(modified);
    assert.strictEqual(modified.path, '/v1/users');
    assert.ok(modified.changes?.some(ch => ch.includes('starting_after')));
  } finally {
    db.close();
  }
});

test('DocDiffEngine: detects added pitfalls across versions', () => {
  const { db, repo } = setupDiffDb();
  try {
    const engine = new DocDiffEngine(repo);
    const diff = engine.diff({
      fromVersion: 'v1',
      toVersion: 'v2',
    });

    assert.strictEqual(diff.summary.pitfallsAdded, 1);
    assert.strictEqual(diff.pitfallChanges[0].pitfall.kind, 'removed');
    assert.ok(diff.pitfallChanges[0].pitfall.title.includes('Charges API Removed'));
  } finally {
    db.close();
  }
});

test('DocDiffEngine: ignores formatting-only whitespace differences in content', () => {
  const { db, repo } = setupDiffDb();
  try {
    const engine = new DocDiffEngine(repo);
    const diff = engine.diff({
      fromVersion: 'v1',
      toVersion: 'v2',
    });

    // Content in chunkV1 and chunkV2 only differ by spaces and newlines
    // Should NOT be counted as a semantic content change
    assert.strictEqual(diff.summary.contentChanged, 0);
  } finally {
    db.close();
  }
});

test('DiffService: synthesizes agent-friendly Markdown report', () => {
  const { db, repo } = setupDiffDb();
  try {
    const service = new DiffService(repo);
    const { result, markdown } = service.diffDocs({
      fromVersion: 'v1',
      toVersion: 'v2',
    });

    assert.ok(result);
    assert.ok(markdown.includes('Documentation Diff: `v1` ➔ `v2`'));
    assert.ok(markdown.includes('POST /v1/payment_intents'));
    assert.ok(markdown.includes('POST /v1/charges'));
    assert.ok(markdown.includes('Charges API Removed in v2'));
  } finally {
    db.close();
  }
});
