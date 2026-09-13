import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readDocsLock,
  writeDocsLock,
  generateDocsLock,
  updateDocsLock,
  DOCS_LOCK_FILENAME,
} from '../../packages/workspace/src/index.ts';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import type { DocsLock, LockedSource } from '../../packages/shared/src/index.ts';

test('DocsLock: backward compatibility with legacy lockfile missing sources array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docorbit-legacy-lock-'));
  try {
    const legacyContent = {
      version: 1,
      workspaceRoot: dir,
      dependencies: {
        stripe: {
          name: 'stripe',
          ecosystem: 'npm',
          requestedVersion: '^14.0.0',
          resolvedDependencyVersion: '14.2.0',
          sourceFile: 'package.json',
          docSourceUrl: 'https://docs.stripe.com',
          docVersion: 'v14',
          matchType: 'exact',
          confidence: 1.0,
          snapshotId: 'snap_123',
          snapshotHash: 'hash_123',
          retrievedAt: '2026-09-01T00:00:00.000Z',
        },
      },
    };

    writeFileSync(join(dir, DOCS_LOCK_FILENAME), JSON.stringify(legacyContent, null, 2), 'utf-8');

    const lock = readDocsLock(dir);
    assert.ok(lock);
    assert.strictEqual(lock.version, 1);
    assert.ok(lock.dependencies['stripe']);
    assert.ok(Array.isArray(lock.sources));
    assert.strictEqual(lock.sources.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DocsLock: writes deterministically sorted sources and dependencies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docorbit-sort-lock-'));
  try {
    const unsortedSources: LockedSource[] = [
      {
        url: 'https://docs.stripe.com/api',
        sourceId: 'src_stripe',
        status: 'ingested',
        snapshotId: 'snap_s',
        snapshotHash: 'hash_s',
        trackedAt: '2026-09-10T00:00:00.000Z',
        updatedAt: '2026-09-10T00:00:00.000Z',
      },
      {
        url: 'https://docs.github.com/en',
        sourceId: 'src_github',
        status: 'ingested',
        snapshotId: 'snap_g',
        snapshotHash: 'hash_g',
        trackedAt: '2026-09-10T00:00:00.000Z',
        updatedAt: '2026-09-10T00:00:00.000Z',
      },
    ];

    const lock: DocsLock = {
      version: 1,
      workspaceRoot: dir,
      dependencies: {},
      sources: unsortedSources,
    };

    writeDocsLock(dir, lock);

    const reRead = readDocsLock(dir);
    assert.ok(reRead);
    assert.ok(reRead.sources);
    assert.strictEqual(reRead.sources.length, 2);
    // GitHub should be sorted before Stripe
    assert.strictEqual(reRead.sources[0].url, 'https://docs.github.com/en');
    assert.strictEqual(reRead.sources[1].url, 'https://docs.stripe.com/api');

    // Verify bit-for-bit stable serialization on repeated writes
    const content1 = readFileSync(join(dir, DOCS_LOCK_FILENAME), 'utf-8');
    writeDocsLock(dir, reRead);
    const content2 = readFileSync(join(dir, DOCS_LOCK_FILENAME), 'utf-8');
    assert.strictEqual(content1, content2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DocsLock: generateDocsLock and updateDocsLock preserve tracked standalone sources', () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  try {
    const existingLock: DocsLock = {
      version: 1,
      workspaceRoot: '/test/workspace',
      dependencies: {},
      sources: [
        {
          url: 'https://docs.github.com/en',
          sourceId: 'src_gh',
          status: 'ingested',
          snapshotId: 'snap_gh',
          snapshotHash: 'hash_gh',
          trackedAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    };

    const emptyScan = {
      workspaceRoot: '/test/workspace',
      manifestsFound: [],
      ecosystems: [],
      dependencies: [],
    };

    const generated = generateDocsLock(emptyScan, repo, existingLock);
    assert.ok(generated.sources);
    assert.strictEqual(generated.sources.length, 1);
    assert.strictEqual(generated.sources[0].url, 'https://docs.github.com/en');

    const updated = updateDocsLock(emptyScan, repo, existingLock);
    assert.ok(updated.sources);
    assert.strictEqual(updated.sources.length, 1);
    assert.strictEqual(updated.sources[0].url, 'https://docs.github.com/en');
  } finally {
    db.close();
  }
});
