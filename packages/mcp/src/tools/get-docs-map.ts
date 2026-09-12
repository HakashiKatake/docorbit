import type { CallToolResult, McpTool } from '../types.ts';
import { type McpContext, type McpToolHandler, formatToolResponse } from './types.ts';
import { ExportService } from '../../../export/src/index.ts';

export class GetDocumentationMapTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'get_documentation_map',
    description: 'Retrieve the hierarchical documentation map, page tree, section headings, and estimated token budget footprints for indexed documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'Optional source ID or source URL substring filter.',
        },
        docVersion: {
          type: 'string',
          description: 'Optional documentation version filter (e.g. "v14", "15.0").',
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
    const sourceId =
      (typeof args.sourceId === 'string' ? args.sourceId : undefined) ||
      (typeof args.source === 'string' ? args.source : undefined) ||
      (typeof args.url === 'string' ? args.url : undefined) ||
      (typeof args.library === 'string' ? args.library : undefined);
    const docVersion =
      (typeof args.docVersion === 'string' ? args.docVersion : undefined) ||
      (typeof args.version === 'string' ? args.version : undefined);

    const exportService = ctx.exportService || new ExportService(ctx.repo);
    const map = exportService.getDocumentationMap({ sourceId, docVersion });

    return formatToolResponse(
      map.markdownTree,
      {
        totalSources: map.totalSources,
        totalPages: map.totalPages,
        totalChunks: map.totalChunks,
        totalEstimatedTokens: map.totalEstimatedTokens,
        sources: map.sources,
        pages: map.pages.map(p => ({
          id: p.id,
          title: p.title,
          url: p.url,
          version: p.version,
          chunkCount: p.chunkCount,
          estimatedTokens: p.estimatedTokens,
          apis: p.apis,
          pitfallCount: p.pitfallCount,
        })),
        untrusted: true,
      },
      args
    );
  }
}
