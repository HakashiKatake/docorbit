import test from 'node:test';
import assert from 'node:assert';
import { createXobinFetch, XOBIN_ORIGIN, xobinDnsLookup } from '../fixtures/xobin-fixture.ts';
import { SecureFetcher } from '../../packages/crawler/src/index.ts';
import { DocumentationRootFinder, DocumentationSiteDetector } from '../../packages/discovery/src/index.ts';
import { DocumentationLinkExtractor } from '../../packages/crawler/src/extractor.ts';
import { DocumentationTreeCrawler } from '../../packages/crawler/src/tree-crawler.ts';
import { IngestionPipeline } from '../../packages/core/src/pipeline.ts';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';

const xobinFetch = createXobinFetch(XOBIN_ORIGIN);
const fetcher = new SecureFetcher({
  allowLocalhostForTesting: true,
  fetchFn: xobinFetch,
  dnsLookup: xobinDnsLookup,
});

test('Xobin Regression: Documentation root discovery from homepage', async () => {
  const rootFinder = new DocumentationRootFinder();
  const result = await rootFinder.findDocumentationRoot(XOBIN_ORIGIN, fetcher);

  assert.ok(result.rootUrl.includes('/api/docs'));
  assert.strictEqual(result.detection.isDocumentation, true);
  assert.strictEqual(result.detection.framework, 'sphinx');
  assert.strictEqual(result.detection.docVersion, 'v2.0');
  assert.ok(result.detection.confidence >= 0.7);
});

test('Xobin Regression: Documentation site detection and deterministic signals', async () => {
  const detector = new DocumentationSiteDetector();
  const res = await fetcher.fetch(`${XOBIN_ORIGIN}/api/docs`);
  const detection = detector.detect(res.finalUrl, res.body, res.status);

  assert.strictEqual(detection.isDocumentation, true);
  assert.strictEqual(detection.framework, 'sphinx');
  assert.strictEqual(detection.docVersion, 'v2.0');
  assert.strictEqual(detection.documentationType, 'api_reference');
  assert.strictEqual(detection.signals.hasDocsFramework, true);
  assert.strictEqual(detection.signals.hasNavOrSidebar, true);
  assert.ok(detection.confidence >= 0.85);
  assert.ok(detection.explanation.includes('Sphinx'));
});

test('Xobin Regression: Documentation link graph and complete tree discovery', async () => {
  const crawler = new DocumentationTreeCrawler(fetcher);
  const result = await crawler.crawlTree(`${XOBIN_ORIGIN}/api/docs`, {
    maxPages: 50,
    maxDepth: 5,
  });

  // Verify tree node hierarchy
  assert.strictEqual(result.tree.url, `${XOBIN_ORIGIN}/api/docs`);
  assert.ok(result.pagesDiscovered >= 15);
  assert.ok(result.pagesIndexed >= 14);

  // Verify children discovered under tree
  const childUrls = result.tree.children.map(c => c.url);
  assert.ok(childUrls.includes(`${XOBIN_ORIGIN}/api/docs/authentication`));
  assert.ok(childUrls.includes(`${XOBIN_ORIGIN}/api/docs/assessment-workflows`));
  assert.ok(childUrls.includes(`${XOBIN_ORIGIN}/api/docs/ai-interview-workflows`));
  assert.ok(childUrls.includes(`${XOBIN_ORIGIN}/api/docs/webhooks`));
  assert.ok(childUrls.includes(`${XOBIN_ORIGIN}/api/docs/assessments`));
  assert.ok(childUrls.includes(`${XOBIN_ORIGIN}/api/docs/tracks`));
  assert.ok(childUrls.includes(`${XOBIN_ORIGIN}/api/docs/xoforms`));
  assert.ok(childUrls.includes(`${XOBIN_ORIGIN}/api/docs/products`));

  // Verify collapsed and nested navigation: Candidates subpages
  const candidateChildUrls = result.fetchedPages?.map(p => p.url) || [];
  assert.ok(candidateChildUrls.includes(`${XOBIN_ORIGIN}/api/docs/candidates/parse-resume`));
  assert.ok(candidateChildUrls.includes(`${XOBIN_ORIGIN}/api/docs/candidates/delete`));
  assert.ok(candidateChildUrls.includes(`${XOBIN_ORIGIN}/api/docs/candidates/cancel-deletion`));

  // Verify hidden HTML link discovered
  assert.ok(candidateChildUrls.includes(`${XOBIN_ORIGIN}/api/docs/hidden-feature`));

  // Verify embedded route manifest link discovered
  assert.ok(candidateChildUrls.includes(`${XOBIN_ORIGIN}/api/docs/dynamic-route`));

  // Verify irrelevant pages were skipped and NOT indexed
  assert.strictEqual(candidateChildUrls.includes(`${XOBIN_ORIGIN}/pricing`), false);
  assert.strictEqual(candidateChildUrls.includes(`${XOBIN_ORIGIN}/login`), false);
  assert.ok(result.pagesSkipped.some(s => s.reason === 'irrelevant_page'));

  // Verify cyclic links did not cause infinite loop and crawl terminated cleanly
  assert.strictEqual(result.bounded, false);
});

test('Xobin Regression: Priority ordering (nav > breadcrumb > body)', async () => {
  const extractor = new DocumentationLinkExtractor();
  const html = `
    <nav class="sidebar">
      <a href="/nav-link">Nav Item</a>
    </nav>
    <div class="breadcrumb">
      <a href="/crumb-link">Crumb Item</a>
    </div>
    <main>
      <a href="/body-link">Body Item</a>
    </main>
  `;

  const result = extractor.extract(html, 'https://example.com/docs');
  const navItem = result.links.find(l => l.url === 'https://example.com/nav-link');
  const crumbItem = result.links.find(l => l.url === 'https://example.com/crumb-link');
  const bodyItem = result.links.find(l => l.url === 'https://example.com/body-link');

  assert.strictEqual(navItem?.priority, 'nav_sidebar');
  assert.strictEqual(crumbItem?.priority, 'breadcrumb');
  assert.strictEqual(bodyItem?.priority, 'body');
});

test('Xobin Regression: Bounded crawl limits and termination reporting', async () => {
  const crawler = new DocumentationTreeCrawler(fetcher);
  const result = await crawler.crawlTree(`${XOBIN_ORIGIN}/api/docs`, {
    maxPages: 3,
  });

  assert.strictEqual(result.bounded, true);
  assert.strictEqual(result.boundedReason, 'Discovery bounded: 3 pages reached');
  assert.strictEqual(result.pagesIndexed, 3);
});

test('Xobin Regression: Full pipeline ingestion, page classification, and hierarchy persistence', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  const pipeline = new IngestionPipeline(repo, {
    allowLocalhostForTesting: true,
    dnsLookup: xobinDnsLookup,
  });
  (pipeline as any).fetcher = fetcher;

  // Ingest from landing page (should discover root and crawl full tree)
  const result = await pipeline.ingest(XOBIN_ORIGIN);

  assert.ok(result.pages.length >= 14);
  assert.strictEqual(result.discoveredDocRoot, `${XOBIN_ORIGIN}/api/docs`);

  // Verify page classifications
  const authPage = result.pages.find(p => p.url.includes('/authentication'));
  assert.ok(authPage);
  assert.strictEqual(authPage.pageType, 'authentication');

  const webhookPage = result.pages.find(p => p.url.includes('/webhooks'));
  assert.ok(webhookPage);
  assert.strictEqual(webhookPage.pageType, 'webhook');

  const resumePage = result.pages.find(p => p.url.includes('/candidates/parse-resume'));
  assert.ok(resumePage);
  assert.strictEqual(resumePage.pageType, 'endpoint');

  const rootPage = result.pages.find(p => p.url === `${XOBIN_ORIGIN}/api/docs`);
  assert.ok(rootPage);
  assert.strictEqual(rootPage.pageType, 'documentation_overview');

  // Verify SQLite database stores and reconstructs the hierarchy tree
  const reconstructedTree = repo.getDocumentTree();
  assert.ok(reconstructedTree);
  assert.strictEqual(reconstructedTree.url, `${XOBIN_ORIGIN}/api/docs`);
  assert.ok(reconstructedTree.children.length > 0);
});
