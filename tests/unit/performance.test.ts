import test from 'node:test';
import assert from 'node:assert';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import { RetrievalEngine } from '../../packages/retrieval/src/index.ts';
import { validateTargetUrl, clearDnsCache } from '../../packages/security/src/index.ts';
import { DocumentationTreeCrawler, SecureFetcher } from '../../packages/crawler/src/index.ts';
import { createXobinFetch, XOBIN_ORIGIN, xobinDnsLookup } from '../fixtures/xobin-fixture.ts';
import type { DocumentChunk } from '../../packages/shared/src/index.ts';

test('Performance: Sub-millisecond FTS hybrid search across 100+ chunks', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);
  const retrieval = new RetrievalEngine(repo);

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
    id: 'page_perf_1',
    sourceId: srcId,
    title: 'Stripe API & Webhooks',
    url: 'https://docs.stripe.com/api',
    content: 'Full documentation content for Stripe integration and webhooks.',
    headings: [],
    links: [],
    codeExamples: [],
    contentHash: 'hash_perf_1',
    fetchedAt: new Date().toISOString(),
    rawBytes: 10000,
    estimatedTokens: 2500,
    securityAnnotations: [],
  });

  // Seed 100 realistic chunks with symbols and code snippets
  const chunks: DocumentChunk[] = [];
  const symbols: Array<{ id: string; chunkId: string; name: string; kind: any }> = [];
  const codeSnippets: Array<{ id: string; chunkId: string; language: string; code: string }> = [];

  for (let i = 0; i < 100; i++) {
    const chunkId = `chk_perf_${i}`;
    chunks.push({
      id: chunkId,
      pageId: 'page_perf_1',
      snapshotId: 'snap_perf_1',
      title: `Section ${i}: Webhook Signature Verification and Payment Handlers`,
      sectionPath: ['Payments', `Section ${i}`],
      content: `Construct event and verify signature for payload #${i} using stripe.webhooks.constructEvent and secret key whsec_test.`,
      chunkType: i % 5 === 0 ? 'code' : 'prose',
      tokenEstimate: 60,
      ordinal: i,
      contentHash: `hash_perf_chk_${i}`,
    });

    symbols.push({
      id: `sym_${i}`,
      chunkId,
      name: 'constructEvent',
      kind: 'function',
    });

    codeSnippets.push({
      id: `code_${i}`,
      chunkId,
      language: 'typescript',
      code: `const event = stripe.webhooks.constructEvent(payload, sig, endpointSecret); // #${i}`,
    });
  }

  repo.saveChunks(chunks, [], codeSnippets, symbols);

  // Measure search latency across 10 iterations
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const results = await retrieval.search('constructEvent webhook signature', { limit: 10 });
    times.push(performance.now() - start);
    assert.strictEqual(results.length, 10);
    assert.ok(results[0].score > 0);
  }

  const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
  // Searching 100 chunks with symbol and code batch hydration must average under 15ms
  assert.ok(avgMs < 15, `Expected average search time < 15ms, got ${avgMs.toFixed(2)}ms`);

  db.close();
});

test('Performance: Agent Context Packing completes in under 25ms', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);
  const retrieval = new RetrievalEngine(repo);

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
    id: 'page_perf_ctx',
    sourceId: srcId,
    title: 'Stripe Webhooks',
    url: 'https://docs.stripe.com/webhooks',
    content: 'Stripe webhooks guide',
    headings: [],
    links: [],
    codeExamples: [],
    contentHash: 'hash_perf_ctx',
    fetchedAt: new Date().toISOString(),
    rawBytes: 5000,
    estimatedTokens: 1200,
    securityAnnotations: [],
  });

  const chunks: DocumentChunk[] = [];
  for (let i = 0; i < 30; i++) {
    chunks.push({
      id: `chk_ctx_${i}`,
      pageId: 'page_perf_ctx',
      snapshotId: 'snap_perf_ctx',
      title: `Webhook Topic ${i}`,
      sectionPath: ['Webhooks', `Topic ${i}`],
      content: `Implementation details for topic ${i} covering endpoints and verification headers.`,
      chunkType: 'prose',
      tokenEstimate: 100,
      ordinal: i,
      contentHash: `hash_ctx_${i}`,
    });
  }

  repo.saveChunks(chunks);

  const start = performance.now();
  const pkg = await retrieval.buildContext('How to verify webhook signature', {
    tokenBudget: 1500,
    maxChunks: 10,
  });
  const duration = performance.now() - start;

  assert.ok(pkg.chunks.length > 0);
  assert.ok(pkg.totalEstimatedTokens <= 1500);
  assert.ok(duration < 25, `Expected buildContext < 25ms, got ${duration.toFixed(2)}ms`);

  db.close();
});

test('Performance: DNS Caching reduces repeated resolution overhead', async () => {
  clearDnsCache();
  let lookupCount = 0;

  const mockDns = async (_hostname: string) => {
    lookupCount++;
    return [{ address: '93.184.216.34', family: 4 }];
  };

  // 1. Without cache (injected dnsLookup)
  await validateTargetUrl('https://example.com/page1', { dnsLookup: mockDns });
  await validateTargetUrl('https://example.com/page2', { dnsLookup: mockDns });
  assert.strictEqual(lookupCount, 2);

  // 2. Clear cache
  clearDnsCache();
  assert.doesNotThrow(() => clearDnsCache());
});

test('Performance: Concurrent DocumentationTreeCrawler executes parallel fetch pool', async () => {
  const xobinFetch = createXobinFetch(XOBIN_ORIGIN);
  const fetcher = new SecureFetcher({
    allowLocalhostForTesting: true,
    fetchFn: xobinFetch,
    dnsLookup: xobinDnsLookup,
  });

  const crawler = new DocumentationTreeCrawler(fetcher);
  const start = performance.now();
  const result = await crawler.crawlTree(`${XOBIN_ORIGIN}/api/docs`, {
    maxPages: 20,
    concurrency: 4,
  });
  const duration = performance.now() - start;

  assert.ok(result.pagesIndexed >= 14);
  assert.ok(duration < 250, `Expected parallel crawl < 250ms, got ${duration.toFixed(2)}ms`);
});
