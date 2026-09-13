import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import { SourceManagementService } from '../../packages/core/src/index.ts';
import { readDocsLock } from '../../packages/workspace/src/index.ts';

test('SourceManager: track-only mode registers source in docs.lock without crawling', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'docorbit-trackonly-'));
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  try {
    const sm = new SourceManagementService(repo, { projectDir: dir });
    const res1 = await sm.addOrTrackSource({
      url: 'https://docs.github.com/en/',
      trackOnly: true,
      title: 'GitHub Documentation',
    });

    assert.strictEqual(res1.status, 'added');
    assert.strictEqual(res1.url, 'https://docs.github.com/en');
    assert.ok(res1.sourceId);

    const lock = readDocsLock(dir);
    assert.ok(lock);
    assert.ok(lock.sources);
    assert.strictEqual(lock.sources.length, 1);
    assert.strictEqual(lock.sources[0].url, 'https://docs.github.com/en');
    assert.strictEqual(lock.sources[0].status, 'tracked');

    // Calling again with different representation (trailing slash + UTM tracking)
    const res2 = await sm.addOrTrackSource({
      url: 'https://DOCS.GITHUB.COM/en?utm_source=twitter',
      trackOnly: true,
    });

    assert.strictEqual(res2.status, 'already_tracked');
    assert.strictEqual(res2.url, 'https://docs.github.com/en');

    // Ensure still exactly 1 tracked source in lockfile
    const lock2 = readDocsLock(dir);
    assert.strictEqual(lock2?.sources?.length, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SourceManager: direct content ingestion creates snapshot and tracks in docs.lock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'docorbit-direct-'));
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  try {
    const sm = new SourceManagementService(repo, { projectDir: dir });
    const content = '# Stripe API\nEndpoints for processing credit card charges.\n';

    const res1 = await sm.addOrTrackSource({
      url: 'https://docs.stripe.com/api',
      content,
      title: 'Stripe API Docs',
    });

    assert.strictEqual(res1.status, 'added');
    assert.strictEqual(res1.url, 'https://docs.stripe.com/api');
    assert.ok(res1.snapshotId);
    assert.strictEqual(res1.pageCount, 1);

    const lock = readDocsLock(dir);
    assert.ok(lock);
    assert.strictEqual(lock.sources?.length, 1);
    assert.strictEqual(lock.sources[0].url, 'https://docs.stripe.com/api');
    assert.strictEqual(lock.sources[0].status, 'ingested');
    assert.strictEqual(lock.sources[0].snapshotId, res1.snapshotId);

    // Idempotency: updating same content returns updated or already_tracked with single source
    const updatedContent = '# Stripe API v2\nUpdated charges endpoint.\n';
    const res2 = await sm.addOrTrackSource({
      url: 'https://docs.stripe.com/api/',
      content: updatedContent,
      force: true,
    });

    assert.strictEqual(res2.status, 'updated');
    const lock2 = readDocsLock(dir);
    assert.strictEqual(lock2?.sources?.length, 1);
    assert.strictEqual(lock2?.sources[0].snapshotId, res2.snapshotId);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SourceManager: canonical identity prevents duplicate source entries across representations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'docorbit-canonical-id-'));
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  try {
    const sm = new SourceManagementService(repo, { projectDir: dir });

    await sm.addOrTrackSource({
      url: 'https://docs.github.com/en',
      content: '# GitHub Docs\nREST API reference\n',
    });

    // Try equivalent representations
    const resSlash = await sm.addOrTrackSource({
      url: 'https://docs.github.com/en/',
    });
    assert.strictEqual(resSlash.status, 'already_tracked');

    const resCase = await sm.addOrTrackSource({
      url: 'HTTPS://DOCS.GITHUB.COM/en',
    });
    assert.strictEqual(resCase.status, 'already_tracked');

    const resQuery = await sm.addOrTrackSource({
      url: 'https://docs.github.com/en?utm_source=newsletter&utm_medium=email',
    });
    assert.strictEqual(resQuery.status, 'already_tracked');

    const resHash = await sm.addOrTrackSource({
      url: 'https://docs.github.com/en#rest-api',
    });
    assert.strictEqual(resHash.status, 'already_tracked');

    // Ensure database contains exactly ONE source record
    const allSources = repo.listSources();
    assert.strictEqual(allSources.length, 1);
    assert.strictEqual(allSources[0].url, 'https://docs.github.com/en');

    // Ensure docs.lock contains exactly ONE source record
    const lock = readDocsLock(dir);
    assert.strictEqual(lock?.sources?.length, 1);
    assert.strictEqual(lock?.sources[0].url, 'https://docs.github.com/en');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
