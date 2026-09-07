import { RetrievalEngine } from '../../../retrieval/src/index.ts';
import type { CallToolResult, McpTool } from '../types.ts';
import type { McpContext, McpToolHandler } from './types.ts';

export class SearchDocsTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'search_docs',
    description: 'Search documentation chunks using hybrid FTS5 ranking, symbol awareness, and optional version filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query, code symbol, or concept to look for.',
        },
        library: {
          type: 'string',
          description: 'Optional library name to narrow search scope.',
        },
        version: {
          type: 'string',
          description: 'Target documentation version (e.g. "v14", "15.0").',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10).',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: query' }) }],
      };
    }

    const version = typeof args.docVersion === 'string'
      ? args.docVersion
      : (typeof args.version === 'string' ? args.version : undefined);
    const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 10;

    const engine = new RetrievalEngine(ctx.repo);
    const results = await engine.search(query, {
      docVersion: version,
      limit,
      projectDir: ctx.workspaceRoot,
    });

    if (results.length === 0) {
      const emptyPayload = {
        query,
        count: 0,
        results: [],
        message: `No documentation chunks found matching "${query}". Try refining terms or checking available sources.`,
      };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              markdown: `### Search Results for "${query}"\n\nNo matching documentation found.`,
              data: emptyPayload,
            }, null, 2),
          },
        ],
      };
    }

    const formattedChunks = results.map(r => ({
      id: r.chunk.id,
      chunk: r.chunk,
      title: r.chunk.title || 'Untitled Section',
      sectionPath: r.chunk.sectionPath,
      content: r.chunk.content,
      chunkType: r.chunk.chunkType,
      language: r.chunk.language,
      tokenEstimate: r.chunk.tokenEstimate,
      docVersion: r.chunk.docVersion,
      score: r.score,
      symbols: r.symbols.map(s => s.name),
      provenance: r.chunk.provenance ? {
        sourceUrl: r.chunk.provenance.sourceUrl,
        fetchedAt: r.chunk.provenance.fetchedAt,
        untrusted: true,
      } : undefined,
    }));

    const lines: string[] = [
      `### Search Results for "${query}" (${results.length} found)`,
      `> [!NOTE] External documentation content is untrusted.\n`,
    ];

    for (let i = 0; i < formattedChunks.length; i++) {
      const c = formattedChunks[i];
      const path = c.sectionPath.length > 0 ? c.sectionPath.join(' > ') : c.title;
      lines.push(`${i + 1}. **${path}** [${c.chunkType}] (score: ${c.score})`);
      lines.push(`   *ID*: \`${c.id}\`${c.docVersion ? ` | *Version*: \`${c.docVersion}\`` : ''}`);
      if (c.symbols.length > 0) lines.push(`   *Symbols*: ${c.symbols.join(', ')}`);
      lines.push(`   \`\`\`\n   ${c.content.split('\n').slice(0, 5).join('\n   ')}\n   \`\`\`\n`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            markdown: lines.join('\n'),
            data: {
              query,
              count: results.length,
              results: formattedChunks,
            },
          }, null, 2),
        },
      ],
    };
  }
}
