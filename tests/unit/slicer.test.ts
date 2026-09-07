import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slicePageIntoChunks,
  extractSymbols,
  detectChunkType,
} from '../../packages/normalizer/src/index.ts';
import type { NormalizedPage } from '../../packages/shared/src/index.ts';

test('Slicer: Heading hierarchy traversal preserves full breadcrumbs', () => {
  const content = `# Payment System
Introduction to payments.

## Webhooks
Webhooks allow asynchronous event notifications.

### Signature Verification
To verify signatures, compare HMAC SHA256 of payload with secret.

\`\`\`typescript
import crypto from 'node:crypto';
export function verifySignature(payload: string, sig: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
\`\`\`

## Event Types
List of supported event types.
`;

  const page: NormalizedPage = {
    id: 'page_test_1',
    sourceId: 'src_test',
    title: 'Payment Documentation',
    url: 'https://example.com/payments',
    content,
    headings: [
      { level: 1, text: 'Payment System', anchor: 'payment-system' },
      { level: 2, text: 'Webhooks', anchor: 'webhooks' },
      { level: 3, text: 'Signature Verification', anchor: 'signature-verification' },
      { level: 2, text: 'Event Types', anchor: 'event-types' },
    ],
    links: [],
    codeExamples: [],
    contentHash: 'hash_test',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: content.length,
    estimatedTokens: Math.ceil(content.length / 4),
    securityAnnotations: [],
  };

  const result = slicePageIntoChunks(page, 'snap_test_1');

  assert.ok(result.chunks.length >= 3, `Expected at least 3 chunks, got ${result.chunks.length}`);

  // Find the signature verification chunk
  const sigChunk = result.chunks.find(c => c.sectionPath.includes('Signature Verification'));
  assert.ok(sigChunk, 'Signature verification chunk should exist');
  assert.deepEqual(sigChunk.sectionPath, ['Payment System', 'Webhooks', 'Signature Verification']);
  assert.equal(sigChunk.title, 'Signature Verification');

  // Verify parent_section relationship
  const parentRel = result.relationships.find(r => r.sourceChunkId === sigChunk.id && r.type === 'parent_section');
  assert.ok(parentRel, 'Subheading should have parent_section relationship');
});

test('Slicer: Atomic code fence preservation (code blocks are never split)', () => {
  const codeBlock = `\`\`\`json
{
  "event": "charge.succeeded",
  "data": {
    "id": "ch_12345",
    "amount": 2000,
    "currency": "usd",
    "status": "paid",
    "customer": "cus_9999"
  }
}
\`\`\``;

  const content = `# API Payload\n\nBelow is the payload structure:\n\n${codeBlock}\n\nEnsure proper validation.`;

  const page: NormalizedPage = {
    id: 'page_test_code',
    sourceId: 'src_test',
    title: 'Payload Spec',
    url: 'https://example.com/payload',
    content,
    headings: [{ level: 1, text: 'API Payload', anchor: 'api-payload' }],
    links: [],
    codeExamples: [],
    contentHash: 'hash_test_code',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: content.length,
    estimatedTokens: 100,
    securityAnnotations: [],
  };

  const result = slicePageIntoChunks(page, 'snap_test_1');
  const codeChunk = result.chunks.find(c => c.content.includes('"ch_12345"'));

  assert.ok(codeChunk, 'Chunk with code block must exist');
  assert.ok(codeChunk.content.includes('```json'), 'Code fence opening must be present');
  assert.ok(codeChunk.content.includes('```'), 'Code fence closing must be present');
  assert.equal(result.codeSnippets.length, 1);
  assert.equal(result.codeSnippets[0].language, 'json');
  assert.ok(result.codeSnippets[0].code.includes('"amount": 2000'));
});

test('Slicer: Admonitions and warnings are bound to host section', () => {
  const content = `# Endpoint Configuration

> [!WARNING]
> Do not expose the webhook secret in client-side code. Doing so compromises authenticity.

Configure your server endpoint to receive events over HTTPS.`;

  const page: NormalizedPage = {
    id: 'page_test_warn',
    sourceId: 'src_test',
    title: 'Configuration',
    url: 'https://example.com/config',
    content,
    headings: [{ level: 1, text: 'Endpoint Configuration', anchor: 'config' }],
    links: [],
    codeExamples: [],
    contentHash: 'hash_test_warn',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: content.length,
    estimatedTokens: 80,
    securityAnnotations: [],
  };

  const result = slicePageIntoChunks(page, 'snap_test_1');
  assert.equal(result.chunks.length, 1);
  const chunk = result.chunks[0];

  assert.ok(chunk.content.includes('[!WARNING]'));
  assert.ok(chunk.content.includes('Configure your server endpoint'));
  assert.deepEqual(chunk.sectionPath, ['Endpoint Configuration']);
});

test('Slicer: Secondary splitting splits oversized sections without breaking blocks', () => {
  // Generate a long section with multiple distinct paragraphs
  const paragraphs = Array.from({ length: 15 }, (_, i) =>
    `Paragraph ${i + 1}: Detailed documentation about system behavior, security protocols, and operational workflows under high concurrency load. Each paragraph has enough content to increment the token count substantially.`
  ).join('\n\n');

  const content = `# Scalability Guide\n\n${paragraphs}`;

  const page: NormalizedPage = {
    id: 'page_test_large',
    sourceId: 'src_test',
    title: 'Scalability',
    url: 'https://example.com/scalability',
    content,
    headings: [{ level: 1, text: 'Scalability Guide', anchor: 'scalability-guide' }],
    links: [],
    codeExamples: [],
    contentHash: 'hash_test_large',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: content.length,
    estimatedTokens: Math.ceil(content.length / 4),
    securityAnnotations: [],
  };

  // Set tight config to force secondary splitting
  const result = slicePageIntoChunks(page, 'snap_test_1', {
    targetTokens: 100,
    maxTokens: 200,
    overlapTokens: 20,
  });

  assert.ok(result.chunks.length > 1, 'Large section must be split into multiple chunks');

  // Verify sequential links exist between sibling chunks
  for (let i = 0; i < result.chunks.length - 1; i++) {
    const nextRel = result.relationships.find(
      r => r.sourceChunkId === result.chunks[i].id && r.targetChunkId === result.chunks[i + 1].id && r.type === 'next_chunk'
    );
    assert.ok(nextRel, `next_chunk link missing between chunk ${i} and ${i + 1}`);
  }
});

test('Slicer: Shallow deterministic symbol extraction', () => {
  const code = `
export class WebhookClient {
  constructor(apiKey: string) {}
}

export function handleWebhookEvent(event: WebhookEvent): Promise<boolean> {
  return Promise.resolve(true);
}

const processPayload = async (data: string) => {
  return JSON.parse(data);
};

POST /v1/webhook_endpoints

api_key: sk_live_12345
tolerance: 300
`;

  const symbols = extractSymbols(code, 'chk_test');
  const names = symbols.map(s => s.name);

  assert.ok(names.includes('WebhookClient'), 'Must extract class symbol');
  assert.ok(names.includes('handleWebhookEvent'), 'Must extract function symbol');
  assert.ok(names.includes('processPayload'), 'Must extract arrow function symbol');
  assert.ok(names.includes('POST /v1/webhook_endpoints'), 'Must extract REST endpoint symbol');
  assert.ok(names.includes('api_key'), 'Must extract config key symbol');
  assert.ok(names.includes('tolerance'), 'Must extract config key symbol');
});
