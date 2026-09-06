import test from 'node:test';
import assert from 'node:assert';
import { performance } from 'node:perf_hooks';
import { buildNormalizedPage } from '../../packages/normalizer/src/index.ts';
import { DocRouterDb, DocRouterRepository } from '../../packages/storage/src/index.ts';
import type { NormalizedPage } from '../../packages/shared/src/index.ts';

function generateHtmlPage(targetBytes: number, title: string): string {
  const paragraph = '<p>This is a technical paragraph explaining distributed API design and cryptographic proofs in detail.</p>\n';
  const codeBlock = '<pre><code class="language-typescript">export async function processTask(id: string): Promise<boolean> { return true; }</code></pre>\n';
  const table = '<table><tr><th>ID</th><th>Status</th></tr><tr><td>1</td><td>OK</td></tr></table>\n';

  let body = `<h1>${title}</h1>\n<h2>Section Overview</h2>\n` + codeBlock + table;

  while (Buffer.byteLength(body, 'utf-8') < targetBytes) {
    body += paragraph;
  }

  return `<!DOCTYPE html><html><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
}

test('Benchmark: 50KB, 500KB, 5MB Page Normalization and Storage', () => {
  const db = new DocRouterDb(':memory:');
  const repo = new DocRouterRepository(db);

  const sourceId = repo.saveSource({
    url: 'https://benchmark.example.com',
    type: 'web',
    discoveredBy: 'benchmark',
    status: 'valid',
    confidence: 1.0,
    authority: 'official',
    machineReadable: false,
  });

  const initialMem = process.memoryUsage().heapUsed;

  const testCases = [
    { name: '50KB Page', size: 50 * 1024, maxNormTimeMs: 100 },
    { name: '500KB Page', size: 500 * 1024, maxNormTimeMs: 350 },
    { name: '5MB Page', size: 5 * 1024 * 1024, maxNormTimeMs: 2500 },
  ];

  const benchmarkMetrics: Array<{
    name: string;
    actualBytes: number;
    normTimeMs: number;
    storeTimeMs: number;
    totalTimeMs: number;
  }> = [];

  for (const tc of testCases) {
    const rawHtml = generateHtmlPage(tc.size, `Benchmark ${tc.name}`);
    const actualBytes = Buffer.byteLength(rawHtml, 'utf-8');

    // 1. Measure Normalization Latency
    const t0 = performance.now();
    const page = buildNormalizedPage({
      sourceId,
      url: `https://benchmark.example.com/${tc.name.toLowerCase().replace(/\s+/g, '-')}`,
      rawContent: rawHtml,
      contentType: 'text/html',
    });
    const t1 = performance.now();
    const normTimeMs = t1 - t0;

    assert.ok(normTimeMs < tc.maxNormTimeMs, `${tc.name} normalization time (${normTimeMs.toFixed(2)}ms) exceeded threshold (${tc.maxNormTimeMs}ms)`);

    // 2. Measure Storage Latency
    const t2 = performance.now();
    repo.savePage(page);
    const t3 = performance.now();
    const storeTimeMs = t3 - t2;

    const totalTimeMs = normTimeMs + storeTimeMs;

    benchmarkMetrics.push({
      name: tc.name,
      actualBytes,
      normTimeMs,
      storeTimeMs,
      totalTimeMs,
    });
  }

  // 3. Benchmark: 50-Page Batch Ingestion
  const batchStart = performance.now();
  for (let i = 0; i < 50; i++) {
    const rawHtml = generateHtmlPage(20 * 1024, `Page ${i + 1}`);
    const page = buildNormalizedPage({
      sourceId,
      url: `https://benchmark.example.com/page-${i + 1}`,
      rawContent: rawHtml,
      contentType: 'text/html',
    });
    repo.savePage(page);
  }
  const batchEnd = performance.now();
  const batchTotalMs = batchEnd - batchStart;
  const avgPerBatchPageMs = batchTotalMs / 50;

  assert.strictEqual(repo.countPages(sourceId), 53);

  const finalMem = process.memoryUsage().heapUsed;
  const memDeltaMb = (finalMem - initialMem) / (1024 * 1024);

  // Print Benchmark Table
  console.log('\n=== DocRouter Milestone 1 Performance Benchmark ===');
  console.log('-----------------------------------------------------------------------------');
  console.log('| Target      | Size       | Normalization | SQLite Storage | Total Time   |');
  console.log('-----------------------------------------------------------------------------');
  for (const m of benchmarkMetrics) {
    const sizeKb = (m.actualBytes / 1024).toFixed(1) + ' KB';
    console.log(
      `| ${m.name.padEnd(11)} | ${sizeKb.padEnd(10)} | ${(m.normTimeMs.toFixed(2) + 'ms').padEnd(13)} | ${(m.storeTimeMs.toFixed(2) + 'ms').padEnd(14)} | ${(m.totalTimeMs.toFixed(2) + 'ms').padEnd(12)} |`
    );
  }
  console.log('-----------------------------------------------------------------------------');
  console.log(`50-Page Batch Ingestion: ${batchTotalMs.toFixed(2)}ms total (${avgPerBatchPageMs.toFixed(2)}ms/page)`);
  console.log(`Heap Memory Delta:       ${memDeltaMb.toFixed(2)} MB`);
  console.log('====================================================\n');

  db.close();
});
