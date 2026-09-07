import test from 'node:test';
import assert from 'node:assert';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import type { DiscoveredSource, NormalizedPage } from '../../packages/shared/src/index.ts';

test('DocOrbitRepository saves and retrieves sources and pages in SQLite', () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  assert.strictEqual(db.isFtsAvailable(), true);

  // 1. Save source
  const source: DiscoveredSource = {
    url: 'https://docs.example.com',
    type: 'web',
    discoveredBy: 'test',
    status: 'valid',
    confidence: 0.95,
    authority: 'official',
    machineReadable: false,
    metadata: { framework: 'docusaurus' },
  };

  const sourceId = repo.saveSource(source);
  assert.ok(sourceId.startsWith('src_'));

  const retrievedSource = repo.getSource(sourceId);
  assert.ok(retrievedSource);
  assert.strictEqual(retrievedSource.url, 'https://docs.example.com');
  assert.strictEqual(retrievedSource.authority, 'official');
  assert.deepStrictEqual(retrievedSource.metadata, { framework: 'docusaurus' });

  // 2. Save page
  const page: NormalizedPage = {
    id: 'page_123',
    sourceId,
    title: 'Authentication Overview',
    url: 'https://docs.example.com/auth',
    content: '# Authentication Overview\nUse OAuth2 tokens to authenticate API calls.',
    headings: [{ level: 1, text: 'Authentication Overview', anchor: 'auth-overview' }],
    links: [{ text: 'OAuth Guide', url: 'https://docs.example.com/oauth', isExternal: false }],
    codeExamples: [{ id: 'c1', language: 'typescript', code: 'const token = "xyz";' }],
    contentHash: 'hash_1234567890abcdef',
    fetchedAt: new Date().toISOString(),
    rawBytes: 150,
    estimatedTokens: 38,
    securityAnnotations: [],
  };

  repo.savePage(page);

  const retrievedPage = repo.getPage('page_123');
  assert.ok(retrievedPage);
  assert.strictEqual(retrievedPage.title, 'Authentication Overview');
  assert.strictEqual(retrievedPage.contentHash, 'hash_1234567890abcdef');
  assert.strictEqual(retrievedPage.headings.length, 1);
  assert.strictEqual(retrievedPage.links.length, 1);
  assert.strictEqual(retrievedPage.codeExamples.length, 1);
  assert.strictEqual(retrievedPage.codeExamples[0].code, 'const token = "xyz";');

  // Count pages
  assert.strictEqual(repo.countPages(sourceId), 1);

  // 3. Create snapshot
  const snapshotId = repo.createSnapshot(sourceId);
  assert.ok(snapshotId.startsWith('snap_'));

  // 4. Test FTS5 Full Text Search
  const ftsResults = repo.searchPagesFts('OAuth2');
  assert.strictEqual(ftsResults.length, 1);
  assert.strictEqual(ftsResults[0].id, 'page_123');

  db.close();
});
