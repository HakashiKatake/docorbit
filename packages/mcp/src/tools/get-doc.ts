import type { CallToolResult, McpTool } from '../types.ts';
import type { McpContext, McpToolHandler } from './types.ts';

export class GetDocTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'get_doc',
    description: 'Retrieve a specific documentation page or contextual chunk by ID or URL with complete metadata and security annotations.',
    inputSchema: {
      type: 'object',
      properties: {
        chunkId: {
          type: 'string',
          description: 'Unique chunk identifier (e.g. "chk_...").',
        },
        pageId: {
          type: 'string',
          description: 'Unique page identifier (e.g. "page_...").',
        },
        url: {
          type: 'string',
          description: 'Normalized source URL of the documentation page.',
        },
      },
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const chunkId = typeof args.chunkId === 'string' ? args.chunkId.trim() : undefined;
    const pageId = typeof args.pageId === 'string' ? args.pageId.trim() : undefined;
    const url = typeof args.url === 'string' ? args.url.trim() : undefined;

    if (!chunkId && !pageId && !url) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Please provide at least one identifier: chunkId, pageId, or url.' }),
          },
        ],
      };
    }

    if (chunkId) {
      const chunk = ctx.repo.getChunk(chunkId);
      if (!chunk) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Chunk not found: ${chunkId}`, available: false }),
            },
          ],
        };
      }

      const codeSnippets = ctx.repo.getChunkCode(chunkId);
      const symbols = ctx.repo.getChunkSymbols(chunkId);
      const relationships = ctx.repo.getChunkRelationships(chunkId);

      const breadcrumb = chunk.sectionPath.length > 0 ? chunk.sectionPath.join(' > ') : (chunk.title || 'General');
      const md = [
        `### Chunk: ${breadcrumb}`,
        `**ID**: \`${chunk.id}\` | **Type**: \`${chunk.chunkType}\` | **Est. Tokens**: ~${chunk.tokenEstimate}`,
        chunk.docVersion ? `**Version**: \`${chunk.docVersion}\`` : '',
        `> [!NOTE] External content is untrusted.\n`,
        chunk.content,
      ].filter(Boolean).join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              markdown: md,
              data: {
                chunk,
                codeSnippets,
                symbols,
                relationships,
                untrusted: true,
              },
            }, null, 2),
          },
        ],
      };
    }

    // Page lookup by ID or URL
    const page = pageId ? ctx.repo.getPage(pageId) : (url ? ctx.repo.getPageByUrl(url) : null);
    if (!page) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: `Page not found for ${pageId ? `pageId: ${pageId}` : `url: ${url}`}`, available: false }),
          },
        ],
      };
    }

    const links = ctx.repo.getPageLinks(page.id);
    const md = [
      `### ${page.title}`,
      `**URL**: ${page.url} | **Tokens**: ~${page.estimatedTokens} | **Hash**: \`${page.contentHash.slice(0, 8)}\``,
      page.securityAnnotations.length > 0
        ? `> [!WARNING] Security alerts detected: ${page.securityAnnotations.map(a => a.patternName).join(', ')}`
        : `> [!NOTE] External content is untrusted.`,
      `\n${page.content}`,
    ].join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            markdown: md,
            data: {
              page,
              links,
              untrusted: true,
            },
          }, null, 2),
        },
      ],
    };
  }
}
