import type { CallToolResult, McpTool } from '../types.ts';
import { type McpContext, type McpToolHandler, formatToolResponse, formatToolError } from './types.ts';

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
        format: {
          type: 'string',
          description: 'Response format: "markdown" (default, human/agent-readable documentation) or "json" (structured raw machine data).',
          enum: ['markdown', 'json'],
        },
      },
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const rawId = typeof args.id === 'string' ? args.id.trim() : (typeof args.docId === 'string' ? args.docId.trim() : undefined);
    let chunkId = typeof args.chunkId === 'string'
      ? args.chunkId.trim()
      : (rawId && rawId.startsWith('chk_') ? rawId : undefined);
    let pageId = typeof args.pageId === 'string'
      ? args.pageId.trim()
      : (rawId && rawId.startsWith('page_') ? rawId : undefined);
    let url = typeof args.url === 'string'
      ? args.url.trim()
      : (rawId && (rawId.startsWith('http://') || rawId.startsWith('https://')) ? rawId : undefined);

    // If rawId was passed without standard prefix, check whether it matches a chunk first
    if (!chunkId && !pageId && !url && rawId) {
      if (ctx.repo.getChunk(rawId)) {
        chunkId = rawId;
      } else {
        pageId = rawId;
      }
    }

    if (!chunkId && !pageId && !url) {
      return formatToolError('Please provide at least one identifier: id, chunkId, pageId, or url.', args);
    }

    if (chunkId) {
      const chunk = ctx.repo.getChunk(chunkId);
      if (!chunk) {
        return formatToolResponse(
          `### Documentation Chunk Not Found\n\nNo chunk found with ID \`${chunkId}\`. Call \`search_docs\` to discover valid chunk IDs.`,
          { error: `Chunk not found: ${chunkId}`, available: false },
          args
        );
      }

      const codeSnippets = ctx.repo.getChunkCode(chunkId);
      const symbols = ctx.repo.getChunkSymbols(chunkId);
      const relationships = ctx.repo.getChunkRelationships(chunkId);

      const breadcrumb = chunk.sectionPath.length > 0 ? chunk.sectionPath.join(' > ') : (chunk.title || 'General');
      const mdParts = [
        `### Chunk: ${breadcrumb}`,
        `**ID**: \`${chunk.id}\` | **Type**: \`${chunk.chunkType}\` | **Est. Tokens**: ~${chunk.tokenEstimate}`,
        chunk.docVersion ? `**Version**: \`${chunk.docVersion}\`` : '',
        `> [!NOTE] External content is untrusted.\n`,
        chunk.content,
      ];

      if (symbols.length > 0) {
        mdParts.push(`**Symbols**: ${symbols.map(s => `\`${s.name}\``).join(', ')}`);
      }

      const md = mdParts.filter(Boolean).join('\n\n');

      return formatToolResponse(
        md,
        {
          chunk,
          codeSnippets,
          symbols,
          relationships,
          untrusted: true,
        },
        args
      );
    }

    // Page lookup by ID or URL
    const page = pageId ? ctx.repo.getPage(pageId) : (url ? ctx.repo.getPageByUrl(url) : null);
    if (!page) {
      return formatToolResponse(
        `### Documentation Page Not Found\n\nNo page found for ${pageId ? `ID \`${pageId}\`` : `URL \`${url}\``}. Call \`list_sources\` to verify indexed documentation.`,
        { error: `Page not found for ${pageId ? `pageId: ${pageId}` : `url: ${url}`}`, available: false },
        args
      );
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

    return formatToolResponse(
      md,
      {
        page,
        links,
        untrusted: true,
      },
      args
    );
  }
}
