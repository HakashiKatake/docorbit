import { BenchmarkRunner } from '../../../../packages/evaluation/src/index.ts';
import type { AgentEvaluationStrategy, EvaluationSplit } from '../../../../packages/evaluation/src/index.ts';
import { c } from '../formatters/colors.ts';

export interface EvaluateCommandOptions {
  split?: string;
  strategy?: string;
  task?: string;
  output?: string;
  json?: boolean;
  verbose?: boolean;
  /** Offline simulation mode — no network required, for CI regression only */
  simulation?: boolean;
}

export async function handleEvaluateCommand(options: EvaluateCommandOptions = {}): Promise<void> {
  const sim = options.simulation ?? false;
  const runner = new BenchmarkRunner({ simulation: sim });

  const split: EvaluationSplit | 'all' =
    options.split === 'train'
      ? 'train'
      : options.split === 'eval'
        ? 'eval'
        : options.split === 'verification'
          ? 'verification'
          : 'all';

  let strategies: AgentEvaluationStrategy[] | undefined;
  if (options.strategy) {
    const list = options.strategy.split(',').map((s) => s.trim());
    strategies = list as AgentEvaluationStrategy[];
  }

  const tasks = options.task ? [options.task] : undefined;

  if (!options.json) {
    const modeLabel = sim
      ? c.yellow('[SIMULATION MODE — offline CI, no network]')
      : c.green('[REAL MODE — requires network access]');
    console.log(c.bold(c.cyan('\n=== DocOrbit Real-World Agent Evaluation Benchmark ===')));
    console.log(modeLabel);
    if (!sim) {
      console.log(c.gray('  Context7: real context7-mcp stdio subprocess (context7.com)'));
      console.log(c.gray('  Firecrawl: real /v1/scrape API (api.firecrawl.dev)'));
      console.log(c.gray('  Official Docs Fetch: direct HTTPS fetch to official docs URLs'));
      console.log(c.gray('  DocOrbit: real in-process MCP server\n'));
    }
    console.log(`Split: ${c.yellow(split)} | Strategies: ${strategies ? strategies.join(', ') : 'all'}`);
    console.log(`Artifacts: ${options.output || 'eval-results/'}\n`);
  }

  const report = await runner.run({
    split,
    strategies,
    tasks,
    outputDir: options.output,
    verbose: options.verbose,
    simulation: sim,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const modeTag = sim ? ' [SIMULATION]' : ' [REAL]';
  console.log(c.bold(c.green(`\nEvaluation Complete${modeTag} — ${report.totalTasks} tasks\n`)));

  const sDocs = report.byStrategy.agent_official_docs_fetch || report.byStrategy.agent_web_search;
  const sFC = report.byStrategy.agent_firecrawl;
  const sDR = report.byStrategy.agent_docorbit;

  if (sDocs && sC7 && sDR) {
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

    if (sFC) {
      const hr = '---------------------------------------------------------------------------------------------------------------------';
      console.log(hr);
      console.log(c.bold(`| ${'Metric'.padEnd(32)}| ${'Official Docs Fetch'.padEnd(21)}| ${'Firecrawl'.padEnd(14)}| ${'Context7'.padEnd(14)}| ${'DocOrbit'.padEnd(14)}|`));
      console.log(hr);

      const row = (label: string, vDocs: string, vFC: string, vC7: string, vDR: string) =>
        `| ${label.padEnd(32)}| ${vDocs.padEnd(21)}| ${vFC.padEnd(14)}| ${vC7.padEnd(14)}| ${vDR.padEnd(14)}|`;

      console.log(row('Overall Task Success Rate', pct(sDocs.overallSuccessRate), pct(sFC.overallSuccessRate), pct(sC7.overallSuccessRate), pct(sDR.overallSuccessRate)));
      console.log(row('Held-Out Eval Success Rate', pct(sDocs.evalSuccessRate), pct(sFC.evalSuccessRate), pct(sC7.evalSuccessRate), pct(sDR.evalSuccessRate)));
      console.log(row('Correct Version Selection', pct(sDocs.versionAccuracy), pct(sFC.versionAccuracy), pct(sC7.versionAccuracy), pct(sDR.versionAccuracy)));
      console.log(row('Retrieval Precision@k', pct(sDocs.meanPrecision), pct(sFC.meanPrecision), pct(sC7.meanPrecision), pct(sDR.meanPrecision)));
      console.log(row('Retrieval Recall@k', pct(sDocs.meanRecall), pct(sFC.meanRecall), pct(sC7.meanRecall), pct(sDR.meanRecall)));
      console.log(row('Mean Token Ingestion', `~${Math.round(sDocs.meanTokens)}`, `~${Math.round(sFC.meanTokens)}`, `~${Math.round(sC7.meanTokens)}`, `~${Math.round(sDR.meanTokens)}`));
      console.log(row('Context Prep Latency', `~${sDocs.meanLatencyMs.toFixed(0)}ms`, `~${sFC.meanLatencyMs.toFixed(0)}ms`, `~${sC7.meanLatencyMs.toFixed(0)}ms`, `~${sDR.meanLatencyMs.toFixed(0)}ms`));
      console.log(row('Avg Tool Calls per Task', sDocs.meanToolCalls.toFixed(1), sFC.meanToolCalls.toFixed(1), sC7.meanToolCalls.toFixed(1), sDR.meanToolCalls.toFixed(1)));
      console.log(row('AST Verification Catches', '—', '—', '—', String(sDR.totalVerificationCatches)));
      console.log(row('Verification False Positives', '—', '—', '—', String(sDR.falsePositives)));
      console.log(hr);
    } else {
      const hr = '--------------------------------------------------------------------------------------------------';
      console.log(hr);
      console.log(c.bold(`| ${'Metric'.padEnd(36)}| ${'Official Docs Fetch'.padEnd(21)}| ${'Context7'.padEnd(14)}| ${'DocOrbit'.padEnd(14)}|`));
      console.log(hr);

      const row = (label: string, vDocs: string, vC7: string, vDR: string) =>
        `| ${label.padEnd(36)}| ${vDocs.padEnd(21)}| ${vC7.padEnd(14)}| ${vDR.padEnd(14)}|`;

      console.log(row('Overall Task Success Rate', pct(sDocs.overallSuccessRate), pct(sC7.overallSuccessRate), pct(sDR.overallSuccessRate)));
      console.log(row('Held-Out Eval Success Rate', pct(sDocs.evalSuccessRate), pct(sC7.evalSuccessRate), pct(sDR.evalSuccessRate)));
      console.log(row('Correct Version Selection', pct(sDocs.versionAccuracy), pct(sC7.versionAccuracy), pct(sDR.versionAccuracy)));
      console.log(row('Retrieval Precision@k', pct(sDocs.meanPrecision), pct(sC7.meanPrecision), pct(sDR.meanPrecision)));
      console.log(row('Retrieval Recall@k', pct(sDocs.meanRecall), pct(sC7.meanRecall), pct(sDR.meanRecall)));
      console.log(row('Mean Token Ingestion', `~${Math.round(sDocs.meanTokens)}`, `~${Math.round(sC7.meanTokens)}`, `~${Math.round(sDR.meanTokens)}`));
      console.log(row('Context Prep Latency', `~${sDocs.meanLatencyMs.toFixed(0)}ms`, `~${sC7.meanLatencyMs.toFixed(0)}ms`, `~${sDR.meanLatencyMs.toFixed(0)}ms`));
      console.log(row('Avg Tool Calls per Task', sDocs.meanToolCalls.toFixed(1), sC7.meanToolCalls.toFixed(1), sDR.meanToolCalls.toFixed(1)));
      console.log(row('AST Verification Catches', '—', '—', String(sDR.totalVerificationCatches)));
      console.log(row('Verification False Positives', '—', '—', String(sDR.falsePositives)));
      console.log(hr);
    }

    if (sDR) {
      console.log(c.bold(c.cyan('\nAST Code Verification (`check_api`) Performance:')));
      console.log(`  Total Verification Catches: ${c.bold(String(sDR.totalVerificationCatches))}`);
      console.log(`  False Positives on Valid Code: ${c.bold(String(sDR.falsePositives))}`);
      console.log(`  Dynamic/Ambiguous Fallback Rate: ${c.bold(pct(sDR.insufficientEvidenceRate))}`);
    }

    if (sim) {
      console.log(c.yellow('\n⚠  Results above are from simulated runners. Run without --simulation for real results.'));
    }
    console.log(c.gray('\n* Official Docs Fetch baseline directly fetches known official documentation URLs over HTTPS rather than querying a search engine.'));
  }

  console.log(`\nRaw artifacts: ${c.cyan(options.output || 'eval-results/')}\n`);
}
