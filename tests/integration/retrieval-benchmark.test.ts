import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import { RetrievalEngine, detectQueryIntent } from '../../packages/retrieval/src/index.ts';
import { slicePageIntoChunks } from '../../packages/normalizer/src/index.ts';
import type { NormalizedPage, DocumentChunk, QueryIntent } from '../../packages/shared/src/index.ts';

interface BenchmarkTestCase {
  category: 'conceptual' | 'api' | 'examples' | 'configuration' | 'troubleshooting' | 'migration' | 'negative';
  query: string;
  expectedIntent: QueryIntent;
  isNegative?: boolean;
  isRelevant: (chunk: DocumentChunk) => boolean;
}

test('Retrieval Benchmark: Evaluation Dataset & Scaling Performance (1k & 10k Chunks)', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  const srcId = repo.saveSource({
    url: 'https://docs.stripe.com',
    type: 'web',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: false,
  });

  // Seed 6 realistic documentation pages
  const pages: NormalizedPage[] = [
    {
      id: 'page_arch',
      sourceId: srcId,
      title: 'Webhook Architecture and Event Lifecycle',
      url: 'https://docs.stripe.com/webhooks/architecture',
      content: `# Webhook Architecture
An overview of the event-driven webhook architecture.

## Event Delivery Lifecycle
When an event occurs in your account, Stripe sends an HTTP POST request to registered endpoints.
Delivery retry guarantees use exponential backoff up to 3 days if an endpoint is unreachable.

## Idempotency and Deduplication
Each event carries a unique \`evt_...\` identifier. Consumers must store processed event IDs to guarantee idempotent handling.`,
      headings: [
        { level: 1, text: 'Webhook Architecture', anchor: 'webhook-architecture' },
        { level: 2, text: 'Event Delivery Lifecycle', anchor: 'delivery-lifecycle' },
        { level: 2, text: 'Idempotency and Deduplication', anchor: 'idempotency' },
      ],
      links: [],
      codeExamples: [],
      contentHash: 'hash_arch',
      fetchedAt: '2026-09-06T12:00:00Z',
      rawBytes: 600,
      estimatedTokens: 150,
      securityAnnotations: [],
    },
    {
      id: 'page_endpoints',
      sourceId: srcId,
      title: 'Webhook Endpoints REST API Reference',
      url: 'https://docs.stripe.com/api/webhook_endpoints',
      content: `# Webhook Endpoints API

## Create Endpoint
\`\`\`http
POST /v1/webhook_endpoints
Authorization: Bearer sk_test_51...
Content-Type: application/json
\`\`\`

## Request Parameters and Headers
The endpoint creation payload requires a destination URL and list of subscribed events:
\`\`\`json
{
  "url": "https://example.com/webhook",
  "enabled_events": ["payment_intent.succeeded", "payment_intent.failed"],
  "description": "Production webhook receiver"
}
\`\`\`

## Response Schema and Status Codes
Returns a \`201 Created\` status with the created webhook endpoint schema including the signing secret \`whsec_...\`.
If validation fails, returns a \`400 Bad Request\` status with error code.`,
      headings: [
        { level: 1, text: 'Webhook Endpoints API', anchor: 'api' },
        { level: 2, text: 'Create Endpoint', anchor: 'create-endpoint' },
        { level: 2, text: 'Request Parameters and Headers', anchor: 'request-params' },
        { level: 2, text: 'Response Schema and Status Codes', anchor: 'response-schema' },
      ],
      links: [],
      codeExamples: [],
      contentHash: 'hash_api',
      fetchedAt: '2026-09-06T12:00:00Z',
      rawBytes: 900,
      estimatedTokens: 220,
      securityAnnotations: [],
    },
    {
      id: 'page_signatures',
      sourceId: srcId,
      title: 'Verifying Webhook Signatures in Node.js',
      url: 'https://docs.stripe.com/webhooks/signatures',
      content: `# Signature Verification

## Verification Overview
Verify event signatures using HMAC-SHA256 to ensure webhook notifications originated from Stripe and have not been tampered with.

## Example Code
\`\`\`typescript
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_API_KEY!);

export function verifyWebhookSignature(payload: string, headerSig: string, secret: string) {
  try {
    const event = stripe.webhooks.constructEvent(payload, headerSig, secret);
    return event;
  } catch (err) {
    throw new Error('Invalid webhook signature');
  }
}
\`\`\`

## Timing Attack and Replay Mitigation
Compare signatures using constant-time comparison to prevent timing attacks, and check timestamp to prevent replay attacks.`,
      headings: [
        { level: 1, text: 'Signature Verification', anchor: 'signatures' },
        { level: 2, text: 'Verification Overview', anchor: 'overview' },
        { level: 2, text: 'Example Code', anchor: 'example-code' },
        { level: 2, text: 'Timing Attack and Replay Mitigation', anchor: 'security' },
      ],
      links: [],
      codeExamples: [],
      contentHash: 'hash_sig',
      fetchedAt: '2026-09-06T12:00:00Z',
      rawBytes: 950,
      estimatedTokens: 240,
      securityAnnotations: [],
    },
    {
      id: 'page_config',
      sourceId: srcId,
      title: 'Webhook Configuration & Security Settings',
      url: 'https://docs.stripe.com/webhooks/configuration',
      content: `# Webhook Configuration

## Environment Variables
Configure the following secrets in your \`.env\` file:
\`\`\`env
STRIPE_WEBHOOK_SECRET=whsec_abc123xyz
STRIPE_TOLERANCE_SECONDS=300
\`\`\`

## HTTPS Requirement
All production webhook endpoints must serve a valid TLS/SSL certificate over HTTPS. HTTP is only permitted on localhost for development testing.

## Endpoint Secret Rotation
Rotate webhook endpoint secrets regularly to minimize exposure risk.`,
      headings: [
        { level: 1, text: 'Webhook Configuration', anchor: 'config' },
        { level: 2, text: 'Environment Variables', anchor: 'env' },
        { level: 2, text: 'HTTPS Requirement', anchor: 'https' },
        { level: 2, text: 'Endpoint Secret Rotation', anchor: 'rotation' },
      ],
      links: [],
      codeExamples: [],
      contentHash: 'hash_cfg',
      fetchedAt: '2026-09-06T12:00:00Z',
      rawBytes: 700,
      estimatedTokens: 175,
      securityAnnotations: [],
    },
    {
      id: 'page_errors',
      sourceId: srcId,
      title: 'Troubleshooting Webhooks and Rate Limit 429 Errors',
      url: 'https://docs.stripe.com/webhooks/troubleshooting',
      content: `# Webhook Troubleshooting

> [!WARNING]
> If your endpoint returns status 429 Too Many Requests, Stripe throttles incoming deliveries to protect your server.

## Handling 429 and Server Failures
Implement queueing (e.g. Redis or BullMQ) to acknowledge receipt with \`200 OK\` in under 2 seconds, and process event payloads asynchronously.

## Exponential Backoff and Retries
For outbound API calls encountering 429 responses, retry using exponential backoff with randomized jitter and honor the \`Retry-After\` header.`,
      headings: [
        { level: 1, text: 'Webhook Troubleshooting', anchor: 'troubleshooting' },
        { level: 2, text: 'Handling 429 and Server Failures', anchor: 'handling-429' },
        { level: 2, text: 'Exponential Backoff and Retries', anchor: 'backoff' },
      ],
      links: [],
      codeExamples: [],
      contentHash: 'hash_err',
      fetchedAt: '2026-09-06T12:00:00Z',
      rawBytes: 850,
      estimatedTokens: 210,
      securityAnnotations: [],
    },
    {
      id: 'page_migration',
      sourceId: srcId,
      title: 'Webhook API Version Migration Guide',
      url: 'https://docs.stripe.com/webhooks/migration',
      content: `# API Version Migration

## Upgrading from 2023-08-16 to 2024-06-20
Review breaking changes before upgrading your webhook endpoint API version.
The customer object \`default_source\` field has been deprecated in favor of \`default_payment_method\`.

## Migration Checklist
1. Test event parsing in the test sandbox.
2. Update SDK client version.
3. Deploy new webhook handler code before updating webhook endpoint version in the dashboard.`,
      headings: [
        { level: 1, text: 'API Version Migration', anchor: 'migration' },
        { level: 2, text: 'Upgrading from 2023-08-16 to 2024-06-20', anchor: 'upgrading' },
        { level: 2, text: 'Migration Checklist', anchor: 'checklist' },
      ],
      links: [],
      codeExamples: [],
      contentHash: 'hash_mig',
      fetchedAt: '2026-09-06T12:00:00Z',
      rawBytes: 600,
      estimatedTokens: 150,
      securityAnnotations: [],
    },
  ];

  // Slice and save all pages
  const snapshotId = repo.createSnapshot(srcId, { test: true });
  for (const page of pages) {
    repo.savePage(page);
    const sliced = slicePageIntoChunks(page, snapshotId);
    repo.saveChunks(sliced.chunks, sliced.relationships, sliced.codeSnippets, sliced.symbols);
  }

  const engine = new RetrievalEngine(repo);

  // 8 Evaluation Test Cases across all required categories
  const testCases: BenchmarkTestCase[] = [
    {
      category: 'conceptual',
      query: 'Architecture and event delivery lifecycle for webhooks',
      expectedIntent: 'conceptual',
      isRelevant: c => c.pageId === 'page_arch',
    },
    {
      category: 'api',
      query: 'POST /v1/webhook_endpoints API request headers and response schema',
      expectedIntent: 'api',
      isRelevant: c => c.pageId === 'page_endpoints',
    },
    {
      category: 'examples',
      query: 'Example code to verify signature with constructEvent in Node.js',
      expectedIntent: 'examples',
      isRelevant: c => c.pageId === 'page_signatures',
    },
    {
      category: 'configuration',
      query: 'Configuring webhook secret environment variables and HTTPS settings',
      expectedIntent: 'configuration',
      isRelevant: c => c.pageId === 'page_config',
    },
    {
      category: 'troubleshooting',
      query: 'Fixing 429 Too Many Requests rate limit error in webhook processing',
      expectedIntent: 'troubleshooting',
      isRelevant: c => c.pageId === 'page_errors',
    },
    {
      category: 'migration',
      query: 'Migrating webhook API version upgrade breaking changes checklist',
      expectedIntent: 'conceptual',
      isRelevant: c => c.pageId === 'page_migration',
    },

    {
      category: 'negative',
      query: 'Kubernetes pod autoscaling daemonset helm values manifest',
      expectedIntent: 'configuration',
      isNegative: true,
      isRelevant: () => false,
    },
    {
      category: 'negative',
      query: 'Quantum teleportation entanglement protocol RFC 99999',
      expectedIntent: 'conceptual',
      isNegative: true,
      isRelevant: () => false,
    },
  ];

  const K = 3;
  let precisionSum = 0;
  let recallSum = 0;
  let mrrSum = 0;
  let evaluatedCount = 0;

  console.log('\n=== DocOrbit Milestone 2 Retrieval Benchmark ===');
  console.log('---------------------------------------------------------------------------------------------');
  console.log('| Category        | Query                                            | P@3   | R@3   | MRR  |');
  console.log('---------------------------------------------------------------------------------------------');

  for (const tc of testCases) {
    const results = await engine.search(tc.query, { limit: K });

    let pAtK = 0;
    let rAtK = 0;
    let mrr = 0;

    if (tc.isNegative) {
      // For negative queries, precision is 1.0 if zero results or if top result score is below threshold
      pAtK = results.length === 0 ? 1.0 : 0.0;
      rAtK = 1.0;
      mrr = results.length === 0 ? 1.0 : 0.0;
    } else {
      const relevantHits = results.filter(r => tc.isRelevant(r.chunk));
      pAtK = results.length > 0 ? relevantHits.length / results.length : 0;

      // Find total relevant chunks in database for recall
      const allChunks = repo.getChunksBySnapshot(snapshotId);
      const totalRelevant = allChunks.filter(c => tc.isRelevant(c)).length;
      rAtK = totalRelevant > 0 ? relevantHits.length / totalRelevant : 1.0;

      const firstRankIdx = results.findIndex(r => tc.isRelevant(r.chunk));
      mrr = firstRankIdx !== -1 ? 1 / (firstRankIdx + 1) : 0;
    }

    precisionSum += pAtK;
    recallSum += rAtK;
    mrrSum += mrr;
    evaluatedCount++;

    const catStr = tc.category.padEnd(15);
    const queryStr = (tc.query.length > 48 ? tc.query.slice(0, 45) + '...' : tc.query).padEnd(48);
    console.log(`| ${catStr} | ${queryStr} | ${pAtK.toFixed(2)}  | ${rAtK.toFixed(2)}  | ${mrr.toFixed(2)} |`);
  }

  const meanPrecisionAtK = precisionSum / evaluatedCount;
  const meanRecallAtK = recallSum / evaluatedCount;
  const meanMrr = mrrSum / evaluatedCount;

  console.log('---------------------------------------------------------------------------------------------');
  console.log(`Overall Precision@${K}: ${meanPrecisionAtK.toFixed(3)}`);
  console.log(`Overall Recall@${K}:    ${meanRecallAtK.toFixed(3)}`);
  console.log(`Overall MRR:           ${meanMrr.toFixed(3)}`);

  // Context packaging token efficiency check
  const ctxPkg = await engine.buildContext('Implement Stripe webhook signature verification in Node.js', {
    tokenBudget: 1500,
  });

  const relevantChunkTokens = ctxPkg.chunks
    .filter(c => c.content.includes('constructEvent') || c.content.includes('verifyWebhookSignature') || c.content.includes('STRIPE_WEBHOOK_SECRET'))
    .reduce((acc, c) => acc + c.tokenEstimate, 0);

  const tokenEfficiency = ctxPkg.totalEstimatedTokens > 0
    ? (relevantChunkTokens / ctxPkg.totalEstimatedTokens)
    : 0;

  console.log(`Token Efficiency:      ${(tokenEfficiency * 100).toFixed(1)}% relevant content tokens in packed budget`);
  console.log('=============================================================================================\n');

  assert.ok(meanPrecisionAtK >= 0.75, `Mean Precision@${K} (${meanPrecisionAtK}) must be >= 0.75`);
  assert.ok(meanRecallAtK >= 0.75, `Mean Recall@${K} (${meanRecallAtK}) must be >= 0.75`);
  assert.ok(meanMrr >= 0.75, `Mean MRR (${meanMrr}) must be >= 0.75`);
  assert.ok(ctxPkg.totalEstimatedTokens <= 1500, 'Context packing must stay within token budget');

  // --- Scaling Benchmarks: 1,000 and 10,000 Chunks ---
  console.log('=== Scaling Performance Benchmark (1,000 & 10,000 Chunks) ===');

  const scaleDb = new DocOrbitDb(':memory:');
  const scaleRepo = new DocOrbitRepository(scaleDb);

  const scaleSrcId = scaleRepo.saveSource({
    url: 'https://scale.benchmark.test',
    type: 'web',
    discoveredBy: 'direct',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: false,
  });

  scaleRepo.savePage({
    id: 'page_scale',
    sourceId: scaleSrcId,
    title: 'Scale Test Page',
    url: 'https://scale.benchmark.test/docs',
    content: 'Scale content',
    headings: [],
    links: [],
    codeExamples: [],
    contentHash: 'hash_scale',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 1000,
    estimatedTokens: 250,
    securityAnnotations: [],
  });

  const generateChunksBatch = (startIdx: number, count: number, snapId: string): DocumentChunk[] => {
    const list: DocumentChunk[] = [];
    for (let i = 0; i < count; i++) {
      const idx = startIdx + i;
      const topic = idx % 5 === 0 ? 'Authentication OAuth'
        : idx % 5 === 1 ? 'Webhooks Event Dispatch'
        : idx % 5 === 2 ? 'Rate Limiting Throttling'
        : idx % 5 === 3 ? 'Database Schema Migration'
        : 'REST API Endpoints Pagination';

      list.push({
        id: `scale_chk_${idx}`,
        pageId: 'page_scale',
        snapshotId: snapId,
        title: `${topic} Module ${idx}`,
        sectionPath: ['Developer Guide', topic, `Section ${idx % 50}`],
        content: `Synthetic documentation content for ${topic} with technical details on handling request ${idx} and operational parameters.`,
        chunkType: idx % 3 === 0 ? 'code' : idx % 3 === 1 ? 'api' : 'prose',
        tokenEstimate: 40,
        ordinal: idx,
        contentHash: `hash_scale_${idx}`,
        provenance: { sourceUrl: 'https://scale.benchmark.test', targetUrl: '', fetchedAt: '', discoveredBy: '', contentHash: '' },
      });
    }
    return list;
  };

  // 1. 1,000 Chunks
  const chunks1k = generateChunksBatch(0, 1000, 'snap_1k');
  const t0_1k = performance.now();
  scaleRepo.saveChunks(chunks1k);
  const insertTime1k = performance.now() - t0_1k;

  const scaleEngine = new RetrievalEngine(scaleRepo);

  const tSearch_1k_start = performance.now();
  const search1kResults = await scaleEngine.search('Authentication OAuth token refresh', { limit: 10 });
  const search1kLatency = performance.now() - tSearch_1k_start;

  const tPack_1k_start = performance.now();
  const pack1k = await scaleEngine.buildContext('Configure Authentication OAuth refresh token flow', { tokenBudget: 2000 });
  const pack1kLatency = performance.now() - tPack_1k_start;

  console.log(`1,000 Chunks:`);
  console.log(`  - Ingestion & FTS Indexing: ${insertTime1k.toFixed(2)}ms (${(insertTime1k / 1000).toFixed(3)}ms/chunk)`);
  console.log(`  - Search Query Latency:     ${search1kLatency.toFixed(2)}ms (found ${search1kResults.length} hits)`);
  console.log(`  - Context Packing Latency:  ${pack1kLatency.toFixed(2)}ms (packed ~${pack1k.totalEstimatedTokens} tokens)`);

  assert.ok(search1kLatency < 50, `1k Search query latency (${search1kLatency.toFixed(2)}ms) must be < 50ms`);
  assert.ok(pack1kLatency < 100, `1k Context packing latency (${pack1kLatency.toFixed(2)}ms) must be < 100ms`);

  // 2. 10,000 Chunks (adding 9,000 more chunks in batches of 3,000)
  const t0_10k = performance.now();
  for (let b = 1000; b < 10000; b += 3000) {
    const batch = generateChunksBatch(b, 3000, 'snap_10k');
    scaleRepo.saveChunks(batch);
  }
  const insertTime10k = performance.now() - t0_10k;

  const tSearch_10k_start = performance.now();
  const search10kResults = await scaleEngine.search('Database Schema Migration rollback script', { limit: 10 });
  const search10kLatency = performance.now() - tSearch_10k_start;

  const tPack_10k_start = performance.now();
  const pack10k = await scaleEngine.buildContext('Run safe zero-downtime database schema migration', { tokenBudget: 3000 });
  const pack10kLatency = performance.now() - tPack_10k_start;

  const memUsage = process.memoryUsage();
  console.log(`\n10,000 Chunks:`);
  console.log(`  - Additional Ingestion (9k): ${insertTime10k.toFixed(2)}ms (${(insertTime10k / 9000).toFixed(3)}ms/chunk)`);
  console.log(`  - Search Query Latency:      ${search10kLatency.toFixed(2)}ms (found ${search10kResults.length} hits)`);
  console.log(`  - Context Packing Latency:   ${pack10kLatency.toFixed(2)}ms (packed ~${pack10k.totalEstimatedTokens} tokens)`);
  console.log(`  - Total Heap Used:           ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log('=============================================================\n');

  assert.ok(search10kLatency < 100, `10k Search query latency (${search10kLatency.toFixed(2)}ms) must be < 100ms`);
  assert.ok(pack10kLatency < 100, `10k Context packing latency (${pack10kLatency.toFixed(2)}ms) must be < 100ms`);

  scaleDb.close();
  db.close();
});
