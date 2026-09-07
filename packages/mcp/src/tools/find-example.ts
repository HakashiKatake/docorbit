import type { CallToolResult, McpTool } from '../types.ts';
import type { McpContext, McpToolHandler } from './types.ts';

export class FindExampleTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'find_example',
    description: 'Find verified, framework-specific code examples by task, language, framework, or target API.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Implementation task or symbol to look for examples of (e.g. "verify webhook signature", "constructEvent").',
        },
        language: {
          type: 'string',
          description: 'Programming language filter (e.g. "typescript", "python", "go").',
        },
        framework: {
          type: 'string',
          description: 'Framework filter (e.g. "express", "fastapi", "next").',
        },
        version: {
          type: 'string',
          description: 'Target documentation version filter.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of examples to return (default: 5).',
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

    const language = typeof args.language === 'string' ? args.language : undefined;
    const framework = typeof args.framework === 'string' ? args.framework : undefined;
    const version = typeof args.docVersion === 'string'
      ? args.docVersion
      : (typeof args.version === 'string' ? args.version : undefined);
    const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 5;

    const examples = ctx.repo.searchIndexedExamples(query, {
      language,
      framework,
      docVersion: version,
      limit,
    });

    if (examples.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              markdown: `### Code Examples for "${query}"\n\nNo verified code examples found.`,
              data: { query, count: 0, examples: [] },
            }, null, 2),
          },
        ],
      };
    }

    const lines: string[] = [`### Verified Code Examples for "${query}" (${examples.length} found)\n`];
    for (const ex of examples) {
      lines.push(`#### ${ex.task} [${ex.language}${ex.framework ? ` / ${ex.framework}` : ''}] (${ex.sourceAuthority})`);
      if (ex.relatedApi) lines.push(`*Target API*: \`${ex.relatedApi}\``);
      lines.push('```' + ex.language);
      lines.push(ex.code);
      lines.push('```\n');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            markdown: lines.join('\n'),
            data: {
              query,
              count: examples.length,
              examples,
            },
          }, null, 2),
        },
      ],
    };
  }
}
