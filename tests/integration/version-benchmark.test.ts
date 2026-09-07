import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import { RetrievalEngine } from '../../packages/retrieval/src/index.ts';
import {
  detectWorkspaceDependencies,
  generateDocsLock,
  writeDocsLock,
} from '../../packages/workspace/src/index.ts';
import type { NormalizedPage, DocumentChunk } from '../../packages/shared/src/index.ts';

test('Version Intelligence Benchmark: multi-version conflict resolution (Next.js 14 vs 15 vs 16)', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'docorbit-version-bench-'));
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);
  const engine = new RetrievalEngine(repo);

  try {
    // 1. Create a Next.js 14 project workspace
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'my-legacy-app',
        dependencies: {
          next: '14.2.3',
          react: '18.3.1',
        },
      })
    );

    // 2. Ingest documentation sources for Next.js across versions 14, 15, 16, and latest
    const srcId = repo.saveSource({
      url: 'https://nextjs.org/docs',
      type: 'web',
      discoveredBy: 'direct',
      status: 'valid',
      confidence: 1.0,
      authority: 'official',
      machineReadable: false,
    });

    // Version 14 Page & Chunks
    repo.savePage({
      id: 'page_next_v14',
      sourceId: srcId,
      title: 'Next.js 14 Dynamic Route Parameters',
      url: 'https://nextjs.org/docs/v14/routing/dynamic-routes',
      content: 'In Next.js 14 App Router, page props params are synchronous objects. Access params directly: export default function Page({ params }: { params: { id: string } }) { return <div>Item {params.id}</div>; }',
      contentHash: 'hash_v14',
      fetchedAt: '2026-01-01T00:00:00Z',
      rawBytes: 500,
      estimatedTokens: 80,
      headings: [],
      links: [],
      codeExamples: [],
      securityAnnotations: [],
    });
    const snap14 = repo.createSnapshot(srcId, { docVersion: 'v14' }, 'v14');

    const chunk14: DocumentChunk = {
      id: 'chunk_next_v14',
      pageId: 'page_next_v14',
      snapshotId: snap14,
      title: 'Next.js 14 Dynamic Route Parameters',
      sectionPath: ['Routing', 'Dynamic Routes'],
      content: 'In Next.js 14 App Router, page props params are synchronous objects. Access params directly: export default function Page({ params }: { params: { id: string } }) { return <div>Item {params.id}</div>; }',
      chunkType: 'example',
      tokenEstimate: 45,
      ordinal: 0,
      contentHash: 'chash_v14',
      docVersion: 'v14',
      provenance: {
        sourceUrl: 'https://nextjs.org/docs',
        targetUrl: 'https://nextjs.org/docs/v14/routing/dynamic-routes',
        fetchedAt: '2026-01-01T00:00:00Z',
        discoveredBy: 'direct',
        contentHash: 'chash_v14',
        snapshotId: snap14,
      },
    };
    repo.saveChunks([chunk14]);

    // Version 15 Page & Chunks
    repo.savePage({
      id: 'page_next_v15',
      sourceId: srcId,
      title: 'Next.js 15 Async Route Parameters',
      url: 'https://nextjs.org/docs/v15/routing/dynamic-routes',
      content: 'In Next.js 15 App Router, params and searchParams are asynchronous Promises. You MUST await them: export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <div>Item {id}</div>; }',
      contentHash: 'hash_v15',
      fetchedAt: '2026-01-01T00:00:00Z',
      rawBytes: 550,
      estimatedTokens: 90,
      headings: [],
      links: [],
      codeExamples: [],
      securityAnnotations: [],
    });
    const snap15 = repo.createSnapshot(srcId, { docVersion: 'v15' }, 'v15');

    const chunk15: DocumentChunk = {
      id: 'chunk_next_v15',
      pageId: 'page_next_v15',
      snapshotId: snap15,
      title: 'Next.js 15 Async Route Parameters',
      sectionPath: ['Routing', 'Dynamic Routes'],
      content: 'In Next.js 15 App Router, params and searchParams are asynchronous Promises. You MUST await them: export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <div>Item {id}</div>; }',
      chunkType: 'example',
      tokenEstimate: 50,
      ordinal: 0,
      contentHash: 'chash_v15',
      docVersion: 'v15',
      provenance: {
        sourceUrl: 'https://nextjs.org/docs',
        targetUrl: 'https://nextjs.org/docs/v15/routing/dynamic-routes',
        fetchedAt: '2026-01-01T00:00:00Z',
        discoveredBy: 'direct',
        contentHash: 'chash_v15',
        snapshotId: snap15,
      },
    };
    repo.saveChunks([chunk15]);

    // Version 16 Page & Chunks
    repo.savePage({
      id: 'page_next_v16',
      sourceId: srcId,
      title: 'Next.js 16 Turbo Routing Stream',
      url: 'https://nextjs.org/docs/v16/routing/dynamic-routes',
      content: 'In Next.js 16 App Router, experimental turbo compiler streaming is default and route params stream asynchronously directly into server components.',
      contentHash: 'hash_v16',
      fetchedAt: '2026-01-01T00:00:00Z',
      rawBytes: 520,
      estimatedTokens: 85,
      headings: [],
      links: [],
      codeExamples: [],
      securityAnnotations: [],
    });
    const snap16 = repo.createSnapshot(srcId, { docVersion: 'v16' }, 'v16');

    const chunk16: DocumentChunk = {
      id: 'chunk_next_v16',
      pageId: 'page_next_v16',
      snapshotId: snap16,
      title: 'Next.js 16 Turbo Routing Stream',
      sectionPath: ['Routing', 'Dynamic Routes'],
      content: 'In Next.js 16 App Router, experimental turbo compiler streaming is default and route params stream asynchronously directly into server components.',
      chunkType: 'example',
      tokenEstimate: 45,
      ordinal: 0,
      contentHash: 'chash_v16',
      docVersion: 'v16',
      provenance: {
        sourceUrl: 'https://nextjs.org/docs',
        targetUrl: 'https://nextjs.org/docs/v16/routing/dynamic-routes',
        fetchedAt: '2026-01-01T00:00:00Z',
        discoveredBy: 'direct',
        contentHash: 'chash_v16',
        snapshotId: snap16,
      },
    };
    repo.saveChunks([chunk16]);

    // Supplemental unversioned / latest page & chunks
    repo.savePage({
      id: 'page_next_latest',
      sourceId: srcId,
      title: 'Next.js Deployment and Vercel Configuration',
      url: 'https://nextjs.org/docs/deployment',
      content: 'Deploying Next.js applications to Vercel requires configuring build output and caching headers.',
      contentHash: 'hash_latest',
      fetchedAt: '2026-01-01T00:00:00Z',
      rawBytes: 400,
      estimatedTokens: 60,
      headings: [],
      links: [],
      codeExamples: [],
      securityAnnotations: [],
    });
    const snapLatest = repo.createSnapshot(srcId, { docVersion: 'latest' }, 'latest');
    const chunkLatest: DocumentChunk = {
      id: 'chunk_next_latest',
      pageId: 'page_next_latest',
      snapshotId: snapLatest,
      title: 'Next.js Deployment and Vercel Configuration',
      sectionPath: ['Deployment'],
      content: 'Deploying Next.js applications to Vercel requires configuring build output and caching headers.',
      chunkType: 'prose',
      tokenEstimate: 35,
      ordinal: 0,
      contentHash: 'chash_latest',
      docVersion: 'latest',
      provenance: {
        sourceUrl: 'https://nextjs.org/docs',
        targetUrl: 'https://nextjs.org/docs/deployment',
        fetchedAt: '2026-01-01T00:00:00Z',
        discoveredBy: 'direct',
        contentHash: 'chash_latest',
        snapshotId: snapLatest,
      },
    };
    repo.saveChunks([chunkLatest]);

    // 3. Generate docs.lock for the Next.js 14 project
    const scan = detectWorkspaceDependencies(tempDir);
    const lock = generateDocsLock(scan, repo);
    writeDocsLock(tempDir, lock);

    assert.strictEqual(lock.dependencies['next'].docVersion, 'v14');
    assert.strictEqual(lock.dependencies['next'].matchType, 'major');

    // 4. Benchmark Query: Searching for route parameters with project awareness
    const query = 'Next.js App Router dynamic route params';
    const results = await engine.search(query, {
      projectDir: tempDir,
      limit: 5,
    });

    console.log('\n=== Milestone 3 Version Disambiguation Benchmark ===');
    console.log('Project: Next.js @ 14.2.3');
    console.log(`Query:   "${query}"`);
    console.log('-----------------------------------------------------------------------------');
    console.log('| Rank | Chunk Doc Version | Score  | Title                                 |');
    console.log('-----------------------------------------------------------------------------');
    results.forEach((r, idx) => {
      const vPad = (r.chunk.docVersion || 'none').padEnd(17);
      const sPad = r.score.toFixed(2).padEnd(6);
      const tPad = (r.chunk.title || '').slice(0, 37).padEnd(37);
      console.log(`| #${idx + 1}   | ${vPad} | ${sPad} | ${tPad} |`);
    });
    console.log('-----------------------------------------------------------------------------\n');

    // Verification 1: The v14 chunk MUST rank #1 for the v14 project
    assert.ok(results.length >= 3);
    assert.strictEqual(results[0].chunk.docVersion, 'v14', 'Rank 1 must be Next.js 14 documentation');
    assert.strictEqual(results[0].chunk.id, 'chunk_next_v14');

    // Verification 2: Score separation between v14 (boosted) and v15/v16 (penalized for major mismatch)
    assert.ok(
      results[0].score > results[1].score,
      `v14 chunk score (${results[0].score}) must exceed competing version score (${results[1].score})`
    );

    // Verification 3: Context Packaging with project awareness
    const contextPkg = await engine.buildContext(
      'Read dynamic route params in Next.js page component',
      { projectDir: tempDir, tokenBudget: 2000 }
    );

    assert.ok(contextPkg.chunks.length > 0);
    assert.strictEqual(contextPkg.chunks[0].docVersion, 'v14');
    assert.ok(contextPkg.markdown.includes('params are synchronous objects'));
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
