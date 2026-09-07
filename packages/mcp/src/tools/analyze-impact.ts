import type { CallToolResult, McpTool } from '../types.ts';
import type { McpContext, McpToolHandler } from './types.ts';
import { ImpactAnalysisService } from '../../../verification/src/index.ts';

export class AnalyzeImpactTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'analyze_impact',
    description: 'Compare detected documentation and API changes against current project workspace files. Identifies affected files, exact line numbers, code snippets, matched patterns, and traceable reasons with certainty rankings (high, medium, heuristic).',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Workspace root directory containing code files to analyze.',
        },
        fromVersion: {
          type: 'string',
          description: 'Current or base documentation version (e.g. "v14").',
        },
        toVersion: {
          type: 'string',
          description: 'Target or upgraded documentation version (e.g. "v15").',
        },
        fromSnapshotId: {
          type: 'string',
          description: 'Optional base snapshot ID.',
        },
        toSnapshotId: {
          type: 'string',
          description: 'Optional target snapshot ID.',
        },
        sourceId: {
          type: 'string',
          description: 'Optional documentation source ID filter.',
        },
      },
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const projectDir = typeof args.project === 'string' ? args.project : (ctx.projectDir || ctx.workspaceRoot || process.cwd());
    const fromVersion = typeof args.fromVersion === 'string' ? args.fromVersion : undefined;
    const toVersion = typeof args.toVersion === 'string' ? args.toVersion : undefined;
    const fromSnapshotId = typeof args.fromSnapshotId === 'string' ? args.fromSnapshotId : undefined;
    const toSnapshotId = typeof args.toSnapshotId === 'string' ? args.toSnapshotId : undefined;
    const sourceId = typeof args.sourceId === 'string' ? args.sourceId : undefined;

    const impactService = ctx.impactService || new ImpactAnalysisService(ctx.repo);
    const { result, markdown } = impactService.analyzeImpact({
      projectDir,
      fromVersion,
      toVersion,
      fromSnapshotId,
      toSnapshotId,
      sourceId,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              markdown,
              data: result,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
