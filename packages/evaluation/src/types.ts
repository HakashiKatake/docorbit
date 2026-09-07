import type {
  AgentEvaluationStrategy,
  EvaluationSplit,
  BenchmarkTaskDoc,
  BenchmarkTaskDef,
  BenchmarkTaskResult,
  StrategyAggregateMetrics,
  BenchmarkSuiteReport,
} from '../../shared/src/index.ts';

export type {
  AgentEvaluationStrategy,
  EvaluationSplit,
  BenchmarkTaskDoc,
  BenchmarkTaskDef,
  BenchmarkTaskResult,
  StrategyAggregateMetrics,
  BenchmarkSuiteReport,
};

export interface RunnerOptions {
  split?: EvaluationSplit | 'all';
  strategies?: AgentEvaluationStrategy[];
  tasks?: string[]; // filter by task ID
  outputDir?: string;
  verbose?: boolean;
  /** When true, use offline simulated runners (no network required, for CI regression). Default: false = real integrations. */
  simulation?: boolean;
}

export interface StrategyRunner {
  readonly strategy: AgentEvaluationStrategy;
  executeTask(task: BenchmarkTaskDef, tempDir: string): Promise<BenchmarkTaskResult>;
}
