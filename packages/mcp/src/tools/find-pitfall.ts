import type { PitfallKind } from '../../../shared/src/index.ts';
import type { CallToolResult, McpTool } from '../types.ts';
import { type McpContext, type McpToolHandler, formatToolResponse, formatToolError } from './types.ts';

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
        format: {
          type: 'string',
          description: 'Response format: "markdown" (default, human/agent-readable documentation) or "json" (structured raw machine data).',
          enum: ['markdown', 'json'],
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const query = (
      typeof args.query === 'string' ? args.query :
      typeof args.topic === 'string' ? args.topic :
      typeof args.task === 'string' ? args.task :
      typeof args.symbol === 'string' ? args.symbol :
      typeof args.concept === 'string' ? args.concept :
      typeof args.search === 'string' ? args.search : ''
    ).trim();

    if (!query) {
      return formatToolError('Missing required parameter: query (or topic, symbol, task)', args);
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
      return formatToolResponse(
        `### Pitfalls & Warnings for "${query}"\n\nNo matching pitfalls or warnings found.\n\n> [!TIP]\n> Try searching documentation text with **\`search_docs(query: "${query}")\`** or verify code syntax with **\`check_api\`**.`,
        { query, count: 0, pitfalls: [] },
        args
      );
    }

    const lines: string[] = [`### Pitfalls & Warnings for "${query}" (${pitfalls.length} found)\n`];
    for (const pf of pitfalls) {
      lines.push(`- ⚠️ **[${pf.kind.toUpperCase()}] ${pf.title}**${pf.docVersion ? ` (${pf.docVersion})` : ''}`);
      if (pf.relatedApi) lines.push(`  *Related API*: \`${pf.relatedApi}\``);
      lines.push(`  ${pf.content}\n`);
    }

    return formatToolResponse(
      lines.join('\n'),
      {
        query,
        count: pitfalls.length,
        pitfalls,
      },
      args
    );
  }
}
