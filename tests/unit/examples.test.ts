import test from 'node:test';
import assert from 'node:assert';
import { extractIndexedExamples } from '../../packages/normalizer/src/example-indexer.ts';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import type { NormalizedPage, DocumentChunk } from '../../packages/shared/src/index.ts';

test('Examples: extractIndexedExamples detects framework, task, and related APIs', () => {
  const page: NormalizedPage = {
    id: 'page_wh',
    sourceId: 'src_wh',
    snapshotId: 'snap_wh',
    url: 'https://example.com/docs/webhooks',
    title: 'Stripe Webhooks Guide',
    content: 'Full documentation content',
    contentHash: 'hash_wh',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 2048,
    estimatedTokens: 500,
    headings: [
      { level: 1, text: 'Webhooks', anchor: 'webhooks' },
      { level: 2, text: 'Verify Signature', anchor: 'verify-signature' },
    ],
    links: [],
    codeExamples: [
      {
        language: 'typescript',
        code: `import express from 'express';
import Stripe from 'stripe';

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  res.json({ received: true });
});`,
        caption: 'Express Webhook Handler',
      },
      {
        language: 'python',
        code: `from fastapi import FastAPI, Request, HTTPException
import stripe

app = FastAPI()

@app.post("/webhook")
async def webhook_endpoint(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    event = stripe.Webhook.construct_event(payload, sig, endpoint_secret)
    return {"status": "success"}`,
      },
    ],
    securityAnnotations: [],
    provenance: {
      sourceUrl: 'https://example.com/docs/webhooks',
      retrievedAt: '2026-09-06T12:00:00Z',
      sourceAuthority: 'official',
    },
  };

  const chunks: DocumentChunk[] = [
    {
      id: 'chunk_1',
      pageId: 'page_wh',
      snapshotId: 'snap_wh',
      title: 'Verify Signature',
      sectionPath: ['Webhooks', 'Verify Signature'],
      content: page.codeExamples[0].code,
      chunkType: 'code',
      language: 'typescript',
      tokenEstimate: 80,
      ordinal: 0,
      contentHash: 'hash_c1',
      provenance: page.provenance,
    },
    {
      id: 'chunk_2',
      pageId: 'page_wh',
      snapshotId: 'snap_wh',
      title: 'FastAPI Webhook',
      sectionPath: ['Webhooks', 'FastAPI Integration'],
      content: page.codeExamples[1].code,
      chunkType: 'code',
      language: 'python',
      tokenEstimate: 70,
      ordinal: 1,
      contentHash: 'hash_c2',
      provenance: page.provenance,
    },
  ];

  const examples = extractIndexedExamples(page, chunks, 'official', 'v1');
  assert.strictEqual(examples.length, 2);

  // Example 1 (Express/TypeScript)
  const ex1 = examples.find(e => e.language === 'typescript');
  assert.ok(ex1);
  assert.strictEqual(ex1.framework, 'express');
  assert.strictEqual(ex1.task, 'Webhooks > Verify Signature');
  assert.strictEqual(ex1.relatedApi, 'POST /api/webhook');
  assert.ok(ex1.relatedSymbol?.includes('constructEvent'));
  assert.strictEqual(ex1.sourceAuthority, 'official');
  assert.strictEqual(ex1.docVersion, 'v1');

  // Example 2 (FastAPI/Python)
  const ex2 = examples.find(e => e.language === 'python');
  assert.ok(ex2);
  assert.strictEqual(ex2.framework, 'fastapi');
  assert.strictEqual(ex2.task, 'Webhooks > FastAPI Integration');
  assert.strictEqual(ex2.relatedApi, 'POST /webhook');
});

test('Examples: SQLite Repository stores and searches examples with language and framework filters', () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  const page: NormalizedPage = {
    id: 'page_store',
    sourceId: 'src_store',
    snapshotId: 'snap_store',
    url: 'https://example.com/docs',
    title: 'Framework Comparisons',
    content: '',
    contentHash: 'h1',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 100,
    estimatedTokens: 20,
    headings: [],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: {
      sourceUrl: 'https://example.com/docs',
      retrievedAt: '2026-09-06T12:00:00Z',
      sourceAuthority: 'official',
    },
  };

  // Save source and page first
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

  repo.saveIndexedExamples([
    {
      id: 'ex_next',
      pageId: page.id,
      snapshotId: page.snapshotId,
      language: 'typescript',
      framework: 'next',
      task: 'Next.js App Router Server Action',
      code: `'use server';\nexport async function createUser(data: FormData) { await db.insert(data); }`,
      sourceUrl: page.url,
      sourceAuthority: 'official',
      docVersion: 'v14',
      createdAt: '2026-09-06T12:00:00Z',
    },
    {
      id: 'ex_express',
      pageId: page.id,
      snapshotId: page.snapshotId,
      language: 'typescript',
      framework: 'express',
      task: 'Express JSON Router',
      code: `import express from 'express';\nconst router = express.Router();`,
      sourceUrl: page.url,
      sourceAuthority: 'official',
      docVersion: 'v4',
      createdAt: '2026-09-06T12:00:00Z',
    },
  ]);

  // Search Next.js example
  const nextHits = repo.searchIndexedExamples('Server Action', { framework: 'next' });
  assert.strictEqual(nextHits.length, 1);
  assert.strictEqual(nextHits[0].framework, 'next');
  assert.strictEqual(nextHits[0].docVersion, 'v14');

  // Search by language
  const tsHits = repo.searchIndexedExamples('', { language: 'typescript' });
  assert.strictEqual(tsHits.length, 2);

  db.close();
});
