import type { CallToolResult, McpTool } from '../types.ts';
import type { McpContext, McpToolHandler } from './types.ts';
import { IngestionPipeline } from '../../../core/src/index.ts';

export class ImplementationContextTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'get_implementation_context',
    description: 'High-level documentation intelligence orchestrator. Automatically resolves workspace dependencies and versions, detects task intent, retrieves relevant chunks, APIs, verified examples, and pitfalls, and compiles an evidence-grounded recipe within a strict token budget.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The specific coding task or feature to implement (e.g. "Implement Stripe webhook signature verification in Express").',
        },
        url: {
          type: 'string',
          description: 'Optional documentation target URL. If provided and not yet indexed in DocOrbit, DocOrbit will automatically ingest and index it before compiling context.',
        },
        project: {
          type: 'string',
          description: 'Path to repository workspace root for project-aware dependency detection (default: current directory).',
        },
        library: {
          type: 'string',
          description: 'Optional primary library or package to focus documentation on (e.g. "stripe", "next").',
        },
        version: {
          type: 'string',
          description: 'Optional explicit target documentation version (e.g. "v14", "15.0").',
        },
        tokenBudget: {
          type: 'number',
          description: 'Maximum token budget for packed context (default: 4000).',
        },
      },
      required: ['task'],
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const task = typeof args.task === 'string' ? args.task.trim() : '';
    if (!task) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: task' }) }],
      };
    }

    const projectPath = typeof args.project === 'string'
      ? args.project
      : (ctx.workspaceRoot || '.');
    const library = typeof args.library === 'string' ? args.library : undefined;
    const version = typeof args.version === 'string' ? args.version : undefined;
    const tokenBudget = typeof args.tokenBudget === 'number' && args.tokenBudget > 0
      ? args.tokenBudget
      : 4000;
    const url = typeof args.url === 'string' ? args.url.trim() : undefined;

    try {
      if (url) {
        const existing = ctx.repo.getSourceByUrl(url);
        if (!existing) {
          try {
            const pipeline = new IngestionPipeline(ctx.repo, {
              crawlerConfig: { maxPages: 20 },
            });
            await pipeline.ingest(url);
          } catch {
            // Proceed gracefully with available context if crawling fails
          }
        }
      }

      const result = await ctx.implService.getContext({
        task,
        projectPath,
        library,
        version,
        tokenBudget,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              markdown: result.markdown,
              data: result,
            }, null, 2),
          },
        ],
      };
    } catch (err: unknown) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: `Failed to compile implementation context: ${err instanceof Error ? err.message : String(err)}`,
            }),
          },
        ],
      };
    }
  }
}
