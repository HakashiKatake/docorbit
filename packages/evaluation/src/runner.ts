import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BENCHMARK_DATASET } from './dataset.ts';
import { DocOrbitRunner } from './strategies/docorbit-runner.ts';
import { Context7Runner, Context7SimulatedRunner } from './strategies/context7-runner.ts';
import { OfficialDocsFetchRunner, OfficialDocsFetchSimulatedRunner, WebSearchRunner, WebSearchSimulatedRunner } from './strategies/web-search-runner.ts';
import { FirecrawlRunner, FirecrawlSimulatedRunner } from './strategies/firecrawl-runner.ts';
import type {
  BenchmarkTaskDef,
  BenchmarkTaskResult,
  BenchmarkSuiteReport,
  StrategyAggregateMetrics,
  RunnerOptions,
  StrategyRunner,
  AgentEvaluationStrategy,
} from './types.ts';

export class BenchmarkRunner {
  private runners: Map<AgentEvaluationStrategy, StrategyRunner>;

  constructor(options: Pick<RunnerOptions, 'simulation'> = {}) {
    const sim = options.simulation ?? false;
    const docsRunner = sim ? new OfficialDocsFetchSimulatedRunner() : new OfficialDocsFetchRunner();
    this.runners = new Map<AgentEvaluationStrategy, StrategyRunner>([
      ['agent_docorbit', new DocOrbitRunner()],
      ['agent_context7', sim ? new Context7SimulatedRunner() : new Context7Runner()],
      ['agent_firecrawl', sim ? new FirecrawlSimulatedRunner() : new FirecrawlRunner()],
      ['agent_official_docs_fetch', docsRunner],
      ['agent_web_search', docsRunner],
    ]);
  }

  async run(options: RunnerOptions = {}): Promise<BenchmarkSuiteReport> {
    const split = options.split || 'all';
    const activeStrategies = options.strategies || ['agent_docorbit', 'agent_context7', 'agent_firecrawl', 'agent_official_docs_fetch'];
    const outputDir = options.outputDir || path.join(process.cwd(), 'eval-results');
    const sim = options.simulation ?? false;
    fs.mkdirSync(path.join(outputDir, 'raw'), { recursive: true });

    let tasks: BenchmarkTaskDef[] = BENCHMARK_DATASET;
    if (split !== 'all') {
      tasks = tasks.filter((t) => t.split === split);
    }
    if (options.tasks && options.tasks.length > 0) {
      const taskSet = new Set(options.tasks);
      tasks = tasks.filter((t) => taskSet.has(t.id));
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docorbit-bench-'));
    const allResults: BenchmarkTaskResult[] = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const mode = sim ? 'SIMULATION' : 'REAL';

    if (options.verbose) {
      console.log(`\n🔬 DocOrbit Benchmark — Mode: ${mode} | Tasks: ${tasks.length} | Split: ${split}`);
      if (!sim) {
        console.log(`   ⚠  Real mode requires network access (context7-mcp + Firecrawl API + HTTPS docs fetch).`);
        console.log(`   ⚠  Run via: node --experimental-strip-types ... (not inside sandbox)`);
      }
    }

    try {
      for (const task of tasks) {
        for (const strategy of activeStrategies) {
          const runner = this.runners.get(strategy);
          if (!runner) continue;

          if (options.verbose) {
            process.stdout.write(`  Running ${strategy}/${task.id}... `);
          }

          const result = await runner.executeTask(task, tempDir);
          allResults.push(result);

          if (options.verbose) {
            const statusIcon = result.taskSuccess ? '✔' : '✘';
            console.log(`${statusIcon}  (${result.latencyMs.toFixed(0)}ms, ${result.tokenUsage} tokens, version=${result.correctVersionSelected})`);
          }

          // Save raw JSON artifact for every result — auditable, reproducible
          const rawArtifactPath = path.join(
            outputDir, 'raw',
            `${timestamp}_${task.id}_${strategy}.json`,
          );
          fs.writeFileSync(
            rawArtifactPath,
            JSON.stringify({ timestamp, mode, task, result }, null, 2),
            'utf-8',
          );
        }
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // Aggregate metrics per strategy
    const byStrategy: Record<AgentEvaluationStrategy, StrategyAggregateMetrics> = {} as any;

    for (const strategy of activeStrategies) {
      const stratResults = allResults.filter((r) => r.strategy === strategy);
      const evalResults = stratResults.filter((r) => r.split === 'eval');

      const tokens = stratResults.map((r) => r.tokenUsage).sort((a, b) => a - b);
      const precisions = stratResults.map((r) => r.retrievalPrecision);
      const recalls = stratResults.map((r) => r.retrievalRecall);
      const latencies = stratResults.map((r) => r.latencyMs);
      const toolCalls = stratResults.map((r) => r.toolCallsCount);

      const mean = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const median = (arr: number[]) => arr.length > 0 ? arr[Math.floor(arr.length / 2)] : 0;

      byStrategy[strategy] = {
        overallSuccessRate: stratResults.length > 0 ? stratResults.filter((r) => r.taskSuccess).length / stratResults.length : 0,
        evalSuccessRate: evalResults.length > 0 ? evalResults.filter((r) => r.taskSuccess).length / evalResults.length : 0,
        versionAccuracy: stratResults.length > 0 ? stratResults.filter((r) => r.correctVersionSelected).length / stratResults.length : 0,
        meanPrecision: mean(precisions),
        meanRecall: mean(recalls),
        meanTokens: mean(tokens),
        medianTokens: median(tokens),
        meanLatencyMs: mean(latencies),
        meanToolCalls: mean(toolCalls),
        totalVerificationCatches: stratResults.reduce((acc, r) => acc + r.verificationCatches, 0),
        falsePositives: stratResults.reduce((acc, r) => acc + r.verificationFalsePositives, 0),
        insufficientEvidenceRate: stratResults.length > 0 ? stratResults.reduce((acc, r) => acc + r.insufficientEvidenceCount, 0) / stratResults.length : 0,
      };
    }

    const trainTasksCount = tasks.filter((t) => t.split === 'train').length;
    const evalTasksCount = tasks.filter((t) => t.split === 'eval').length;
    const verificationTasksCount = tasks.filter((t) => t.split === 'verification').length;

    const report: BenchmarkSuiteReport = {
      timestamp,
      totalTasks: tasks.length,
      trainTasks: trainTasksCount,
      evalTasks: evalTasksCount,
      verificationTasks: verificationTasksCount,
      byStrategy,
      tasks: allResults,
    };

    // Save summary artifacts
    const summaryJsonPath = path.join(outputDir, `summary_${timestamp}.json`);
    fs.writeFileSync(summaryJsonPath, JSON.stringify(report, null, 2), 'utf-8');

    const markdownReport = this.generateMarkdownReport(report, mode);
    const summaryMdPath = path.join(outputDir, `summary_${timestamp}.md`);
    fs.writeFileSync(summaryMdPath, markdownReport, 'utf-8');

    if (options.verbose) {
      console.log('\n' + markdownReport);
      console.log(`\nArtifacts saved to: ${outputDir}/`);
    }

    return report;
  }

  generateMarkdownReport(report: BenchmarkSuiteReport, mode = 'REAL'): string {
    const isSim = mode === 'SIMULATION';
    const modeNote = isSim
      ? '\n> **⚠ SIMULATION MODE** — Results are offline models of real behavior for CI regression testing. Run without `--simulation` for real results.\n'
      : '\n> **✅ REAL MODE** — Context7: real `context7-mcp` stdio subprocess. Firecrawl: real `api.firecrawl.dev` scrape API. Official Docs Fetch: direct HTTPS fetch to official docs URLs. DocOrbit: real in-process MCP server.\n';

    const lines: string[] = [];
    lines.push(`# DocOrbit Empirical Evaluation & Benchmark Report`);
    lines.push(`**Mode**: ${mode} | **Generated**: ${report.timestamp}`);
    const taskBreakdown = [
      `${report.totalTasks} total`,
      `${report.trainTasks} train`,
      `${report.evalTasks} held-out eval`,
      report.verificationTasks ? `${report.verificationTasks} verification` : undefined,
    ].filter(Boolean).join(', ');
    lines.push(`**Tasks Evaluated**: ${taskBreakdown}`);
    lines.push(modeNote);
    lines.push('## Comparative System Metrics');
    lines.push('');
    const sDocs = report.byStrategy.agent_official_docs_fetch || report.byStrategy.agent_web_search;
    const sC7 = report.byStrategy.agent_context7;
    const sFC = report.byStrategy.agent_firecrawl;
    const sDR = report.byStrategy.agent_docorbit;

    if (sDocs && sC7 && sDR) {
      if (sFC) {
        lines.push('| Metric | Official Docs Fetch | Firecrawl | Context7 (Real MCP) | DocOrbit (Real MCP) |');
        lines.push('| :--- | :---: | :---: | :---: | :---: |');
        lines.push(`| **Task Success Rate** | ${pct(sDocs.overallSuccessRate)} | ${pct(sFC.overallSuccessRate)} | ${pct(sC7.overallSuccessRate)} | ${pct(sDR.overallSuccessRate)} |`);
        lines.push(`| **Held-out Eval Success** | ${pct(sDocs.evalSuccessRate)} | ${pct(sFC.evalSuccessRate)} | ${pct(sC7.evalSuccessRate)} | ${pct(sDR.evalSuccessRate)} |`);
        lines.push(`| **Correct Version Selection** | ${pct(sDocs.versionAccuracy)} | ${pct(sFC.versionAccuracy)} | ${pct(sC7.versionAccuracy)} | ${pct(sDR.versionAccuracy)} |`);
        lines.push(`| **Retrieval Precision@k** | ${pct(sDocs.meanPrecision)} | ${pct(sFC.meanPrecision)} | ${pct(sC7.meanPrecision)} | ${pct(sDR.meanPrecision)} |`);
        lines.push(`| **Retrieval Recall@k** | ${pct(sDocs.meanRecall)} | ${pct(sFC.meanRecall)} | ${pct(sC7.meanRecall)} | ${pct(sDR.meanRecall)} |`);
        lines.push(`| **Mean Tokens** | ~${Math.round(sDocs.meanTokens)} | ~${Math.round(sFC.meanTokens)} | ~${Math.round(sC7.meanTokens)} | ~${Math.round(sDR.meanTokens)} |`);
        lines.push(`| **Mean Latency** | ~${sDocs.meanLatencyMs.toFixed(0)}ms | ~${sFC.meanLatencyMs.toFixed(0)}ms | ~${sC7.meanLatencyMs.toFixed(0)}ms | ~${sDR.meanLatencyMs.toFixed(0)}ms |`);
        lines.push(`| **Avg Tool Calls** | ${sDocs.meanToolCalls.toFixed(1)} | ${sFC.meanToolCalls.toFixed(1)} | ${sC7.meanToolCalls.toFixed(1)} | ${sDR.meanToolCalls.toFixed(1)} |`);
        lines.push(`| **AST Verification Catches** | — | — | — | ${sDR.totalVerificationCatches} |`);
        lines.push(`| **False Positives** | — | — | — | ${sDR.falsePositives} |`);
      } else {
        lines.push('| Metric | Official Docs Fetch | Context7 (Real MCP) | DocOrbit (Real MCP) |');
        lines.push('| :--- | :---: | :---: | :---: |');
        lines.push(`| **Task Success Rate** | ${pct(sDocs.overallSuccessRate)} | ${pct(sC7.overallSuccessRate)} | ${pct(sDR.overallSuccessRate)} |`);
        lines.push(`| **Held-out Eval Success** | ${pct(sDocs.evalSuccessRate)} | ${pct(sC7.evalSuccessRate)} | ${pct(sDR.evalSuccessRate)} |`);
        lines.push(`| **Correct Version Selection** | ${pct(sDocs.versionAccuracy)} | ${pct(sC7.versionAccuracy)} | ${pct(sDR.versionAccuracy)} |`);
        lines.push(`| **Retrieval Precision@k** | ${pct(sDocs.meanPrecision)} | ${pct(sC7.meanPrecision)} | ${pct(sDR.meanPrecision)} |`);
        lines.push(`| **Retrieval Recall@k** | ${pct(sDocs.meanRecall)} | ${pct(sC7.meanRecall)} | ${pct(sDR.meanRecall)} |`);
        lines.push(`| **Mean Tokens** | ~${Math.round(sDocs.meanTokens)} | ~${Math.round(sC7.meanTokens)} | ~${Math.round(sDR.meanTokens)} |`);
        lines.push(`| **Mean Latency** | ~${sDocs.meanLatencyMs.toFixed(0)}ms | ~${sC7.meanLatencyMs.toFixed(0)}ms | ~${sDR.meanLatencyMs.toFixed(0)}ms |`);
        lines.push(`| **Avg Tool Calls** | ${sDocs.meanToolCalls.toFixed(1)} | ${sC7.meanToolCalls.toFixed(1)} | ${sDR.meanToolCalls.toFixed(1)} |`);
        lines.push(`| **AST Verification Catches** | — | — | ${sDR.totalVerificationCatches} |`);
        lines.push(`| **False Positives** | — | — | ${sDR.falsePositives} |`);
      }
    }

    lines.push('');
    lines.push('## AST Code Verification (`check_api`) Performance');
    lines.push('');
    lines.push('DocOrbit provides closed-loop AST verification (`check_api`) to validate generated code against authoritative schemas and constraints. Other baselines lack code verification capabilities.');
    lines.push('');
    lines.push(`- **Total Verification Catches**: ${sDR?.totalVerificationCatches ?? 0}`);
    lines.push(`- **False Positives on Valid Code**: ${sDR?.falsePositives ?? 0}`);
    lines.push(`- **Dynamic / Ambiguous Expression Safe Fallback**: ${sDR ? `${(sDR.insufficientEvidenceRate * 100).toFixed(0)}%` : '0%'}`);
    lines.push('');

    lines.push('## Per-Task Execution Breakdown');
    lines.push('');
    lines.push('| Task | Split | Strategy | Sim? | VersionOK | Success | Tokens | Latency | Catches | Notes |');
    lines.push('| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |');

    for (const res of report.tasks) {
      const simFlag = res.isSimulation ? '🔶' : '✅';
      lines.push(
        `| \`${res.taskId}\` | ${res.split} | \`${res.strategy}\` | ${simFlag} | ${res.correctVersionSelected ? '✔' : '✘'} | ${res.taskSuccess ? '✔' : '✘'} | ${res.tokenUsage} | ${res.latencyMs.toFixed(0)}ms | ${res.verificationCatches} | ${res.notes.slice(0, 75)} |`
      );
    }

    return lines.join('\n');
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
