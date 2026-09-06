import test from 'node:test';
import assert from 'node:assert';
import {
  normalizeHtmlToMarkdown,
  parseLlmsTxt,
  isValidLlmsTxt,
  detectOpenApiSpec,
  buildNormalizedPage,
} from '../../packages/normalizer/src/index.ts';
import { computeContentHash } from '../../packages/shared/src/index.ts';

test('normalizeHtmlToMarkdown extracts headings, code blocks, tables, and removes boilerplate', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Stripe Subscriptions Guide | Stripe Docs</title></head>
      <body>
        <nav class="sidebar"><a href="/">Home</a></nav>
        <header>Site Banner</header>
        <main>
          <h1 id="sub-guide">Subscription Integration</h1>
          <p>Create recurring billing with Stripe Billing.</p>
          <h2 id="step-1">Step 1: Create a Customer</h2>
          <pre><code class="language-typescript">const customer = await stripe.customers.create({
  email: 'test@example.com',
});</code></pre>
          <div class="alert alert-warning">Never expose your secret key on client side!</div>
          <table>
            <tr><th>Status</th><th>Description</th></tr>
            <tr><td>active</td><td>Subscription is current</td></tr>
            <tr><td>canceled</td><td>Subscription has ended</td></tr>
          </table>
          <p>Learn more about <a href="/docs/webhooks">Webhooks</a>.</p>
        </main>
        <footer>Copyright 2026</footer>
      </body>
    </html>
  `;

  const extracted = normalizeHtmlToMarkdown(html, 'https://docs.stripe.com/billing');

  assert.strictEqual(extracted.title, 'Subscription Integration');
  assert.ok(extracted.markdown.includes('# Subscription Integration'));
  assert.ok(extracted.markdown.includes('## Step 1: Create a Customer'));
  assert.ok(extracted.markdown.includes('```typescript\nconst customer = await stripe.customers.create('));
  assert.ok(extracted.markdown.includes('> [!NOTE]\n> Never expose your secret key on client side!'));
  assert.ok(extracted.markdown.includes('| Status | Description |'));
  assert.ok(extracted.markdown.includes('| active | Subscription is current |'));
  assert.ok(extracted.markdown.includes('[Webhooks](https://docs.stripe.com/docs/webhooks)'));

  // Boilerplate should be stripped
  assert.strictEqual(extracted.markdown.includes('Site Banner'), false);
  assert.strictEqual(extracted.markdown.includes('Copyright 2026'), false);

  assert.strictEqual(extracted.codeExamples.length, 1);
  assert.strictEqual(extracted.codeExamples[0].language, 'typescript');
  assert.ok(extracted.codeExamples[0].code.includes('stripe.customers.create'));

  assert.strictEqual(extracted.headings.length, 2);
  assert.strictEqual(extracted.headings[0].level, 1);
  assert.strictEqual(extracted.headings[1].level, 2);
});

test('parseLlmsTxt parses standard llms.txt structure correctly', () => {
  const llmsText = `# Supabase Docs
> The open source Firebase alternative.

## Guides
- [Authentication](/docs/guides/auth): User management and OAuth
- [Database](/docs/guides/database): PostgreSQL and realtime

## API Reference
- [JavaScript Client](https://supabase.com/docs/reference/javascript): Full JS SDK reference
`;

  assert.strictEqual(isValidLlmsTxt(llmsText), true);

  const doc = parseLlmsTxt(llmsText, 'https://supabase.com');
  assert.strictEqual(doc.title, 'Supabase Docs');
  assert.strictEqual(doc.summary, 'The open source Firebase alternative.');
  assert.strictEqual(doc.sections.length, 2);

  assert.strictEqual(doc.sections[0].name, 'Guides');
  assert.strictEqual(doc.sections[0].links.length, 2);
  assert.strictEqual(doc.sections[0].links[0].title, 'Authentication');
  assert.strictEqual(doc.sections[0].links[0].url, 'https://supabase.com/docs/guides/auth');
  assert.strictEqual(doc.sections[0].links[0].description, 'User management and OAuth');

  assert.strictEqual(doc.sections[1].name, 'API Reference');
  assert.strictEqual(doc.sections[1].links[0].url, 'https://supabase.com/docs/reference/javascript');
});

test('detectOpenApiSpec extracts spec version, servers, and endpoints count', () => {
  const openapiJson = JSON.stringify({
    openapi: '3.1.0',
    info: {
      title: 'Petstore API',
      version: '1.0.0',
      description: 'Sample pet store API',
    },
    servers: [{ url: 'https://api.petstore.com/v1' }],
    paths: {
      '/pets': { get: {}, post: {} },
      '/pets/{id}': { get: {}, delete: {} },
    },
  });

  const summary = detectOpenApiSpec(openapiJson, 'https://api.petstore.com/openapi.json');
  assert.ok(summary);
  assert.strictEqual(summary.specVersion, '3.1.0');
  assert.strictEqual(summary.title, 'Petstore API');
  assert.strictEqual(summary.pathCount, 2);
  assert.strictEqual(summary.servers[0], 'https://api.petstore.com/v1');
});

test('computeContentHash is stable across whitespace normalization', () => {
  const doc1 = '# Title\n\nSome content with code.\n';
  const doc2 = '# Title\r\n\r\nSome content with code.  \r\n';

  assert.strictEqual(computeContentHash(doc1), computeContentHash(doc2));
});

test('buildNormalizedPage produces complete NormalizedPage model', () => {
  const html = `<html><head><title>Test</title></head><body><h1>Hello World</h1><pre><code class="language-js">console.log(1);</code></pre></body></html>`;

  const page = buildNormalizedPage({
    sourceId: 'src_123',
    url: 'https://example.com/test',
    rawContent: html,
    contentType: 'text/html',
  });

  assert.strictEqual(page.title, 'Hello World');
  assert.strictEqual(page.sourceId, 'src_123');
  assert.strictEqual(page.url, 'https://example.com/test');
  assert.ok(page.content.includes('# Hello World'));
  assert.strictEqual(page.codeExamples.length, 1);
  assert.strictEqual(page.codeExamples[0].language, 'js');
  assert.ok(page.contentHash.length === 64);
  assert.ok(page.estimatedTokens > 0);
});
