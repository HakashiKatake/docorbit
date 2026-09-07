import type { CallToolResult, McpTool } from '../types.ts';
import type { McpContext, McpToolHandler } from './types.ts';

export class FindApiTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'find_api',
    description: 'Lookup structured OpenAPI endpoints by path, operation ID, or keyword with exact parameters, schemas, auth, and error responses.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'API path or keyword search (e.g. "/v1/webhook_endpoints", "create subscription").',
        },
        method: {
          type: 'string',
          description: 'HTTP method filter (e.g. "get", "post", "delete").',
          enum: ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'],
        },
        version: {
          type: 'string',
          description: 'Target API / documentation version filter.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of endpoints to return (default: 5).',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const query = (
      typeof args.query === 'string' ? args.query :
      typeof args.symbol === 'string' ? args.symbol :
      typeof args.path === 'string' ? args.path :
      typeof args.endpoint === 'string' ? args.endpoint :
      typeof args.name === 'string' ? args.name :
      typeof args.task === 'string' ? args.task :
      typeof args.search === 'string' ? args.search : ''
    ).trim();

    if (!query) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: query (or symbol, path, endpoint)' }) }],
      };
    }

    const method = typeof args.method === 'string' ? args.method.toLowerCase() : undefined;
    const version = typeof args.version === 'string'
      ? args.version
      : (typeof args.docVersion === 'string' ? args.docVersion : undefined);
    const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 5;

    const endpoints = ctx.repo.searchApiEndpoints(query, {
      method,
      docVersion: version,
      limit,
    });

    if (endpoints.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              markdown: `### API Search for "${query}"\n\nNo matching API endpoints found.\n\n> [!TIP]\n> Try searching documentation text with **\`search_docs(query: "${query}")\`**, or call **\`list_sources\`** to verify indexed documentation.`,
              data: { query, count: 0, endpoints: [] },
            }, null, 2),
          },
        ],
      };
    }

    const lines: string[] = [`### API Intelligence for "${query}" (${endpoints.length} found)\n`];
    for (const ep of endpoints) {
      lines.push(`#### \`${ep.method.toUpperCase()} ${ep.path}\`${ep.deprecated ? ' [DEPRECATED]' : ''}`);
      if (ep.summary) lines.push(`*${ep.summary}*`);
      if (ep.parameters.length > 0) {
        const pList = ep.parameters.map(p => `${p.name}${p.required ? '*' : ''} (${p.in}:${p.type || 'any'})`).join(', ');
        lines.push(`- **Parameters**: ${pList}`);
      }
      if (ep.auth.length > 0) {
        lines.push(`- **Auth**: ${ep.auth.map(a => `${a.type}${a.scheme ? `:${a.scheme}` : ''}`).join(', ')}`);
      }
      if (ep.pagination) {
        lines.push(`- **Pagination**: ${ep.pagination.type} (${ep.pagination.parameters.join(', ')})`);
      }
      lines.push('');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            markdown: lines.join('\n'),
            data: {
              query,
              count: endpoints.length,
              endpoints,
            },
          }, null, 2),
        },
      ],
    };
  }
}
