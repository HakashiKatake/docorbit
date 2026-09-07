import type { PitfallKind } from '../../../shared/src/index.ts';
import type { CallToolResult, McpTool } from '../types.ts';
import type { McpContext, McpToolHandler } from './types.ts';

export class FindPitfallTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'find_pitfall',
    description: 'Search documented pitfalls, gotchas, deprecations, breaking changes, and runtime restrictions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Topic, feature, or symbol to inspect for pitfalls (e.g. "webhook raw body", "route params").',
        },
        kind: {
          type: 'string',
          description: 'Category filter for pitfalls.',
          enum: ['deprecated', 'removed', 'breaking_change', 'gotcha', 'security', 'runtime_restriction', 'server_only', 'rate_limit'],
        },
        version: {
          type: 'string',
          description: 'Target documentation version filter.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of pitfalls to return (default: 5).',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const query = typeof args.query === 'string'
      ? args.query.trim()
      : (typeof args.task === 'string' ? args.task.trim() : '');
    if (!query) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: query (or task)' }) }],
      };
    }

    const kind = typeof args.kind === 'string' ? (args.kind as PitfallKind) : undefined;
    const version = typeof args.docVersion === 'string'
      ? args.docVersion
      : (typeof args.version === 'string' ? args.version : undefined);
    const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 5;

    const pitfalls = ctx.repo.searchPitfalls(query, {
      kind,
      docVersion: version,
      limit,
    });

    if (pitfalls.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              markdown: `### Pitfalls & Warnings for "${query}"\n\nNo matching pitfalls or warnings found.`,
              data: { query, count: 0, pitfalls: [] },
            }, null, 2),
          },
        ],
      };
    }

    const lines: string[] = [`### Pitfalls & Warnings for "${query}" (${pitfalls.length} found)\n`];
    for (const pf of pitfalls) {
      lines.push(`- ⚠️ **[${pf.kind.toUpperCase()}] ${pf.title}**${pf.docVersion ? ` (${pf.docVersion})` : ''}`);
      if (pf.relatedApi) lines.push(`  *Related API*: \`${pf.relatedApi}\``);
      lines.push(`  ${pf.content}\n`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            markdown: lines.join('\n'),
            data: {
              query,
              count: pitfalls.length,
              pitfalls,
            },
          }, null, 2),
        },
      ],
    };
  }
}
