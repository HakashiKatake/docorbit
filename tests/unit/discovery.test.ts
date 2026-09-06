import test from 'node:test';
import assert from 'node:assert';
import { createFixtureFetch, FIXTURE_ORIGIN } from '../fixtures/server.ts';
import { SecureFetcher } from '../../packages/crawler/src/index.ts';
import {
  createDefaultDiscoveryCoordinator,
  LlmsTxtProvider,
  OpenApiProvider,
  MarkdownProvider,
  SitemapProvider,
} from '../../packages/discovery/src/index.ts';

const fetcher = new SecureFetcher({
  allowLocalhostForTesting: true,
  fetchFn: createFixtureFetch(FIXTURE_ORIGIN),
});

test('LlmsTxtProvider discovers valid llms.txt and llms-full.txt', async () => {
  const provider = new LlmsTxtProvider();
  const sources = await provider.discover(`${FIXTURE_ORIGIN}/fixture-c`, fetcher);

  assert.ok(sources.length > 0);
  const llmsTxt = sources.find(s => s.type === 'llms_txt');
  assert.ok(llmsTxt);
  assert.strictEqual(llmsTxt.machineReadable, true);
  assert.strictEqual(llmsTxt.status, 'valid');

  const llmsFull = sources.find(s => s.type === 'llms_full_txt');
  assert.ok(llmsFull);
  assert.strictEqual(llmsFull.status, 'valid');
});

test('OpenApiProvider discovers OpenAPI 3.0.3 specification', async () => {
  const provider = new OpenApiProvider();
  const sources = await provider.discover(`${FIXTURE_ORIGIN}/fixture-d`, fetcher);

  assert.ok(sources.length > 0);
  const openapi = sources[0];
  assert.strictEqual(openapi.type, 'openapi');
  assert.strictEqual(openapi.status, 'valid');
  assert.strictEqual(openapi.machineReadable, true);
  assert.strictEqual((openapi.metadata as any)?.specVersion, '3.0.3');
  assert.strictEqual((openapi.metadata as any)?.pathCount, 2);
});

test('MarkdownProvider discovers direct .md file', async () => {
  const provider = new MarkdownProvider();
  const sources = await provider.discover(`${FIXTURE_ORIGIN}/fixture-f`, fetcher);

  assert.ok(sources.length > 0);
  const mdSource = sources[0];
  assert.strictEqual(mdSource.type, 'markdown');
  assert.strictEqual(mdSource.status, 'valid');
  assert.strictEqual(mdSource.machineReadable, true);
});

test('SitemapProvider discovers sitemap.xml', async () => {
  const provider = new SitemapProvider();
  const sources = await provider.discover(`${FIXTURE_ORIGIN}/fixture-i`, fetcher);

  assert.ok(sources.length > 0);
  const sitemapSource = sources[0];
  assert.strictEqual(sitemapSource.type, 'sitemap');
  assert.strictEqual(sitemapSource.status, 'valid');
});

test('DiscoveryCoordinator aggregates and deduplicates sources from multiple providers', async () => {
  const coordinator = createDefaultDiscoveryCoordinator();
  const sources = await coordinator.discoverAll(`${FIXTURE_ORIGIN}/fixture-d`, fetcher);

  assert.ok(sources.length >= 2);
  const hasOpenApi = sources.some(s => s.type === 'openapi');
  const hasWeb = sources.some(s => s.type === 'web');
  assert.strictEqual(hasOpenApi, true);
  assert.strictEqual(hasWeb, true);

  // Check deduplication
  const urls = sources.map(s => s.url);
  const uniqueUrls = new Set(urls);
  assert.strictEqual(urls.length, uniqueUrls.size);
});
