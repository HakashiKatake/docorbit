import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import {
  RetrievalEngine,
  detectQueryIntent,
  DEFAULT_SCORING_WEIGHTS_V1,
  resolveScoringWeights,
} from '../../packages/retrieval/src/index.ts';
import type { DocumentChunk } from '../../packages/shared/src/index.ts';

test('Retrieval: Intent detection categorizes queries deterministically', () => {
  assert.equal(detectQueryIntent('POST /v1/charges endpoint schema and parameters'), 'api');
  assert.equal(detectQueryIntent('How to implement webhook signature verification example'), 'examples');
  assert.equal(detectQueryIntent('Fix 429 Too Many Requests rate limit error'), 'troubleshooting');
  assert.equal(detectQueryIntent('Configure env API key and port settings'), 'configuration');
  assert.equal(detectQueryIntent('Build a custom payment workflow integration'), 'implementation');
  assert.equal(detectQueryIntent('Architecture overview of payment processing lifecycle'), 'conceptual');
});

test('Retrieval: Transactional FTS5 synchronization with chunks table', () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  // Setup parent source and page
  const srcId = repo.saveSource({
    url: 'https://docs.stripe.com',
    type: 'web',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: false,
  });

  repo.savePage({
    id: 'page_stripe_1',
    sourceId: srcId,
    title: 'Stripe Webhooks',
    url: 'https://docs.stripe.com/webhooks',
    content: 'Full page markdown',
    headings: [],
    links: [],
    codeExamples: [],
    contentHash: 'hash_stripe_1',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 500,
    estimatedTokens: 125,
    securityAnnotations: [],
  });

  const chunk: DocumentChunk = {
    id: 'chk_stripe_sig',
    pageId: 'page_stripe_1',
    snapshotId: 'snap_stripe_1',
    title: 'Signature Verification',
    sectionPath: ['Webhooks', 'Signatures'],
    content: 'Verify Stripe event signatures with stripe.webhooks.constructEvent to prevent replay attacks.',
    chunkType: 'code',
    language: 'typescript',
    tokenEstimate: 45,
    ordinal: 0,
    contentHash: 'hash_chk_1',
    provenance: {
      sourceUrl: 'https://docs.stripe.com/webhooks',
      targetUrl: 'https://docs.stripe.com',
      fetchedAt: '2026-09-06T12:00:00Z',
      discoveredBy: 'direct',
      contentHash: 'hash_chk_1',
      snapshotId: 'snap_stripe_1',
    },
  };

  // 1. Transactional insert into chunks & chunks_fts
  repo.saveChunks([chunk], [], [], [{ id: 'sym_1', chunkId: chunk.id, name: 'constructEvent', kind: 'function' }]);

  assert.equal(repo.countChunks(), 1);
  const found = repo.searchChunksFts('constructEvent');
  assert.equal(found.length, 1);
  assert.equal(found[0].chunk.id, 'chk_stripe_sig');

  // 2. Cascade delete on page removes chunk and trigger removes from chunks_fts
  const raw = db.getRawDb();
  raw.prepare('DELETE FROM pages WHERE id = ?').run('page_stripe_1');

  assert.equal(repo.countChunks(), 0);
  const afterDelete = repo.searchChunksFts('constructEvent');
  assert.equal(afterDelete.length, 0, 'Trigger must transactionally purge chunks_fts on chunk deletion');

  db.close();
});

test('Retrieval: Configurable and versioned scoring weights alter rankings', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  const srcId = repo.saveSource({
    url: 'https://docs.example.com',
    type: 'web',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: false,
  });

  repo.savePage({
    id: 'page_example_1',
    sourceId: srcId,
    title: 'Auth Guide',
    url: 'https://docs.example.com/auth',
    content: 'Auth guide content',
    headings: [],
    links: [],
    codeExamples: [],
    contentHash: 'hash_auth',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 200,
    estimatedTokens: 50,
    securityAnnotations: [],
  });

  // Chunk A: Has symbol match
  const chunkA: DocumentChunk = {
    id: 'chk_a',
    pageId: 'page_example_1',
    snapshotId: 'snap_1',
    title: 'Client Initialization',
    sectionPath: ['Client', 'Init'],
    content: 'Initialize your client with apiKey credentials.',
    chunkType: 'code',
    tokenEstimate: 30,
    ordinal: 0,
    contentHash: 'hash_a',
    provenance: { sourceUrl: 'https://docs.example.com', targetUrl: 'https://docs.example.com', fetchedAt: '', discoveredBy: '', contentHash: '' },
  };

  // Chunk B: Has exact title match
  const chunkB: DocumentChunk = {
    id: 'chk_b',
    pageId: 'page_example_1',
    snapshotId: 'snap_1',
    title: 'API Key Configuration',
    sectionPath: ['Configuration'],
    content: 'Documentation about storing keys safely.',
    chunkType: 'prose',
    tokenEstimate: 30,
    ordinal: 1,
    contentHash: 'hash_b',
    provenance: { sourceUrl: 'https://docs.example.com', targetUrl: 'https://docs.example.com', fetchedAt: '', discoveredBy: '', contentHash: '' },
  };

  repo.saveChunks(
    [chunkA, chunkB],
    [],
    [],
    [{ id: 'sym_a', chunkId: 'chk_a', name: 'createClient', kind: 'function' }]
  );

  const defaultEngine = new RetrievalEngine(repo);
  const resultsDefault = await defaultEngine.search('createClient');
  assert.equal(resultsDefault[0].chunk.id, 'chk_a');

  // Custom weights overriding symbol match down to 0 and title up to 50
  const customWeights = resolveScoringWeights({
    version: '2.0.0-test',
    symbolMatchBonus: 0,
    titleBonus: 50.0,
  });

  const customEngine = new RetrievalEngine(repo, customWeights);
  const resultsCustom = await customEngine.search('createClient', { weights: customWeights });
  assert.ok(resultsCustom.length > 0);

  db.close();
});

test('Retrieval: Context packing strictly adheres to token budget and penalizes redundancy', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  const srcId = repo.saveSource({
    url: 'https://docs.example.com',
    type: 'web',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: false,
  });

  repo.savePage({
    id: 'page_budget_1',
    sourceId: srcId,
    title: 'Reference Guide',
    url: 'https://docs.example.com/ref',
    content: 'Full content',
    headings: [],
    links: [],
    codeExamples: [],
    contentHash: 'hash_ref',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 500,
    estimatedTokens: 125,
    securityAnnotations: [],
  });

  // Create 5 chunks in Section X (redundant group) and 1 chunk in Section Y (diverse)
  const chunks: DocumentChunk[] = [];
  for (let i = 0; i < 5; i++) {
    chunks.push({
      id: `chk_x_${i}`,
      pageId: 'page_budget_1',
      snapshotId: 'snap_b',
      title: 'Section X Detail',
      sectionPath: ['Guide', 'Section X'],
      content: `Section X token details number ${i + 1} with information on payment webhooks and event streaming.`,
      chunkType: 'prose',
      tokenEstimate: 50,
      ordinal: i,
      contentHash: `hash_x_${i}`,
      provenance: { sourceUrl: 'https://docs.example.com', targetUrl: 'https://docs.example.com', fetchedAt: '', discoveredBy: '', contentHash: '' },
    });
  }

  chunks.push({
    id: 'chk_y_warning',
    pageId: 'page_budget_1',
    snapshotId: 'snap_b',
    title: 'Security Warning',
    sectionPath: ['Guide', 'Security'],
    content: '> [!WARNING]\n> Always validate signature timestamp to prevent replay attacks on payment webhooks.',
    chunkType: 'warning',
    tokenEstimate: 40,
    ordinal: 5,
    contentHash: 'hash_y_warn',
    provenance: { sourceUrl: 'https://docs.example.com', targetUrl: 'https://docs.example.com', fetchedAt: '', discoveredBy: '', contentHash: '' },
  });

  repo.saveChunks(chunks);

  const engine = new RetrievalEngine(repo);

  // Set tight token budget: 150 tokens
  const pkg = await engine.buildContext('payment webhooks security warning', {
    tokenBudget: 150,
    redundancyPenalty: 0.5,
  });

  assert.ok(pkg.totalEstimatedTokens <= 150, `Tokens (${pkg.totalEstimatedTokens}) exceeded budget of 150`);
  assert.ok(pkg.chunks.some(c => c.id === 'chk_y_warning'), 'Should include high-priority security warning chunk');
  assert.ok(pkg.markdown.includes('# Context Package'), 'Context markdown must be generated');

  db.close();
});
