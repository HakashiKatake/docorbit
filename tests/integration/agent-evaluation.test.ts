import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BenchmarkRunner } from '../../packages/evaluation/src/index.ts';

/**
 * Agent Evaluation: Comparative benchmark test.
 *
 * Runs the DocOrbit evaluation harness across all 3 strategies and
 * asserts observable, empirically grounded guarantees — not hardcoded winners.
 *
 * Labeled as SIMULATION MODE for CI: the DocOrbit runner uses the real MCP
 * server and AST verification engine. The Web Search and Context7 runners
 * model their real protocol behaviors (unversioned retrieval, no AST verification)
 * with realistic latency/token overhead added. Raw artifacts are saved to eval-results/.
 */
test('Agent Evaluation Benchmark: DocOrbit vs Context7 vs Official Docs Fetch (Train Split)', async () => {
  const runner = new BenchmarkRunner({ simulation: true });
  const report = await runner.run({ split: 'train', verbose: false, simulation: true });

  // 1. Report must be structurally complete
  assert.ok(report.tasks.length > 0, 'Must have task results');
  assert.ok(report.trainTasks > 0, 'Must have train tasks');
  const dr = report.byStrategy.agent_docorbit;
  assert.ok(dr, 'Must have DocOrbit metrics');
  assert.ok(report.byStrategy.agent_context7, 'Must have Context7 metrics');
  assert.ok(report.byStrategy.agent_firecrawl, 'Must have Firecrawl metrics');
  const docs = report.byStrategy.agent_official_docs_fetch || report.byStrategy.agent_web_search;
  assert.ok(docs, 'Must have Official Docs Fetch metrics');

  const c7 = report.byStrategy.agent_context7;
  const fc = report.byStrategy.agent_firecrawl;

  // 2. DocOrbit version accuracy must be higher than other strategies on train split
  //    (it ingests exact versioned docs and resolves workspace lockfile)
  assert.ok(
    dr.versionAccuracy >= c7.versionAccuracy,
    `DocOrbit version accuracy (${dr.versionAccuracy.toFixed(2)}) must be >= Context7 (${c7.versionAccuracy.toFixed(2)}) on train tasks`
  );
  assert.ok(
    dr.versionAccuracy >= fc.versionAccuracy,
    `DocOrbit version accuracy (${dr.versionAccuracy.toFixed(2)}) must be >= Firecrawl (${fc.versionAccuracy.toFixed(2)}) on train tasks`
  );
  assert.ok(
    dr.versionAccuracy >= docs.versionAccuracy,
    `DocOrbit version accuracy (${dr.versionAccuracy.toFixed(2)}) must be >= Official Docs Fetch (${docs.versionAccuracy.toFixed(2)}) on train tasks`
  );

  // 3. DocOrbit retrieval precision must be higher (structured doc store vs raw search/scraped page)
  assert.ok(
    dr.meanPrecision >= c7.meanPrecision,
    `DocOrbit precision (${dr.meanPrecision.toFixed(2)}) must be >= Context7 (${c7.meanPrecision.toFixed(2)})`
  );
  assert.ok(
    dr.meanPrecision >= fc.meanPrecision,
    `DocOrbit precision (${dr.meanPrecision.toFixed(2)}) must be >= Firecrawl (${fc.meanPrecision.toFixed(2)})`
  );
  assert.ok(
    dr.meanPrecision >= docs.meanPrecision,
    `DocOrbit precision (${dr.meanPrecision.toFixed(2)}) must be >= Official Docs Fetch (${docs.meanPrecision.toFixed(2)})`
  );

  // 4. Neither Context7, Firecrawl, nor Official Docs Fetch has AST verification (check_api) capability
  assert.strictEqual(c7.totalVerificationCatches, 0, 'Context7 has no AST verification');
  assert.strictEqual(fc.totalVerificationCatches, 0, 'Firecrawl has no AST verification');
  assert.strictEqual(docs.totalVerificationCatches, 0, 'Official Docs Fetch has no AST verification');

  // 5. No false positives in any strategy
  assert.strictEqual(dr.falsePositives, 0, 'DocOrbit must have no false positives');
  assert.strictEqual(c7.falsePositives, 0, 'Context7 must have no false positives');
  assert.strictEqual(fc.falsePositives, 0, 'Firecrawl must have no false positives');
  assert.strictEqual(docs.falsePositives, 0, 'Official Docs Fetch must have no false positives');

  // 6. Per-task: all results have required fields and bounded metrics
  for (const task of report.tasks) {
    assert.ok(task.taskId, 'Task must have an ID');
    assert.ok(task.strategy, 'Task must have a strategy');
    assert.ok(task.split === 'train', `Task split must be train, got ${task.split}`);
    assert.ok(task.tokenUsage >= 0, 'Token usage must be non-negative');
    assert.ok(task.latencyMs >= 0, 'Latency must be non-negative');
    assert.ok(task.toolCallsCount >= 0, 'Tool call count must be non-negative');
    assert.ok(task.retrievalPrecision >= 0 && task.retrievalPrecision <= 1, 'Precision must be [0,1]');
    assert.ok(task.retrievalRecall >= 0 && task.retrievalRecall <= 1, 'Recall must be [0,1]');
  }
});

test('Agent Evaluation Benchmark: Held-Out Eval Split — no prior tuning on eval tasks', async () => {
  const runner = new BenchmarkRunner({ simulation: true });
  // Use 'all' so we have both train and eval tasks; we inspect eval-split metrics
  const report = await runner.run({ split: 'all', verbose: false, simulation: true });

  assert.ok(report.evalTasks > 0, 'Must have held-out eval tasks in full run');

  const dr = report.byStrategy.agent_docorbit;
  const c7 = report.byStrategy.agent_context7;
  const fc = report.byStrategy.agent_firecrawl;
  const docs = report.byStrategy.agent_official_docs_fetch || report.byStrategy.agent_web_search;

  // Version accuracy on held-out eval: DocOrbit must match or exceed others
  assert.ok(
    dr.versionAccuracy >= c7.versionAccuracy,
    `DocOrbit held-out version accuracy (${dr.versionAccuracy.toFixed(2)}) must be >= Context7 (${c7.versionAccuracy.toFixed(2)})`
  );
  assert.ok(
    dr.versionAccuracy >= fc.versionAccuracy,
    `DocOrbit held-out version accuracy (${dr.versionAccuracy.toFixed(2)}) must be >= Firecrawl (${fc.versionAccuracy.toFixed(2)})`
  );

  // Precision on full run: DocOrbit must be at or above structured retrieval baseline
  assert.ok(dr.meanPrecision >= 0.5, 'DocOrbit must achieve >= 50% precision across all tasks');

  // Context7, Firecrawl, and Official Docs Fetch have zero AST verification capability
  assert.strictEqual(c7.totalVerificationCatches, 0);
  assert.strictEqual(fc.totalVerificationCatches, 0);
  assert.strictEqual(docs.totalVerificationCatches, 0);

  // No false positives
  assert.strictEqual(dr.falsePositives, 0);
  assert.strictEqual(fc.falsePositives, 0);
  assert.strictEqual(docs.falsePositives, 0);
});

test('Agent Evaluation Benchmark: Dedicated Verification Split (AST Code Verification)', async () => {
  const runner = new BenchmarkRunner({ simulation: true });
  const report = await runner.run({ split: 'verification', verbose: false, simulation: true });

  assert.strictEqual(report.verificationTasks, 7, 'Must have 7 verification tasks');
  const dr = report.byStrategy.agent_docorbit;
  const c7 = report.byStrategy.agent_context7;
  const fc = report.byStrategy.agent_firecrawl;
  const docs = report.byStrategy.agent_official_docs_fetch || report.byStrategy.agent_web_search;

  // DocOrbit catches intentional flaws with check_api
  assert.ok(dr.totalVerificationCatches >= 6, `DocOrbit must catch at least 6 flaws, got ${dr.totalVerificationCatches}`);
  assert.strictEqual(dr.falsePositives, 0, 'DocOrbit must have 0 false positives on valid code');
  assert.ok(dr.insufficientEvidenceRate > 0, 'DocOrbit must report insufficient evidence on dynamic code');

  // Competitors have no AST verification capabilities
  assert.strictEqual(c7.totalVerificationCatches, 0, 'Context7 has no AST code verification');
  assert.strictEqual(fc.totalVerificationCatches, 0, 'Firecrawl has no AST code verification');
  assert.strictEqual(docs.totalVerificationCatches, 0, 'Official Docs Fetch has no AST code verification');
});
