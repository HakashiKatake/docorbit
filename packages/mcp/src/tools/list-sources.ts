import type { CallToolResult, McpTool } from '../types.ts';
import type { McpContext, McpToolHandler } from './types.ts';

export class ListSourcesTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'list_sources',
    description: 'List all indexed documentation sources, snapshot records, doc versions, and machine-readability status.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of sources to list (default: 50).',
        },
      },
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 50;

    const sources = ctx.repo.listSources().slice(0, limit);
    const snapshots = ctx.repo.listSnapshots();

    if (sources.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              markdown: '### Indexed Documentation Sources\n\nNo documentation sources have been indexed yet. Use the `ingest_doc` tool with a documentation URL (e.g. `ingest_doc(url: "https://...")`) to index documentation directly.',
              data: { count: 0, sources: [] },
            }, null, 2),
          },
        ],
      };
    }

    const formatted = sources.map(s => {
      const sourceSnaps = snapshots.filter(sn => sn.sourceId === s.id);
      return {
        id: s.id,
        url: s.url,
        type: s.type,
        status: s.status,
        authority: s.authority,
        confidence: s.confidence,
        machineReadable: s.machineReadable,
        snapshots: sourceSnaps.map(sn => ({
          id: sn.id,
          pageCount: sn.pageCount,
          docVersion: sn.docVersion,
          capturedAt: sn.capturedAt,
        })),
      };
    });

    const lines: string[] = [`### Indexed Documentation Sources (${sources.length} sources)\n`];
    for (const s of formatted) {
      const icon = s.status === 'valid' ? '✓' : '✗';
      lines.push(`- **${icon} [${s.type}]** ${s.url}`);
      lines.push(`  *Authority*: ${s.authority} | *Confidence*: ${Math.round(s.confidence * 100)}% | *Machine-Readable*: ${s.machineReadable}`);
      if (s.snapshots.length > 0) {
        const snapInfo = s.snapshots.map(sn => `${sn.id}${sn.docVersion ? ` (${sn.docVersion})` : ''} [${sn.pageCount} pages]`).join(', ');
        lines.push(`  *Snapshots*: ${snapInfo}`);
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
              count: formatted.length,
              sources: formatted,
            },
          }, null, 2),
        },
      ],
    };
  }
}
