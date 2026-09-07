import type { CallToolResult, McpTool } from '../types.ts';
import type { McpContext, McpToolHandler } from './types.ts';
import { DiffService } from '../../../verification/src/index.ts';

export class DiffDocsTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'diff_docs',
    description: 'Compare documentation snapshots and versions to detect added, removed, modified, and deprecated API endpoints, parameters, pitfalls, and content sections. Produces deterministic diffs ignoring formatting-only changes.',
    inputSchema: {
      type: 'object',
      properties: {
        fromVersion: {
          type: 'string',
          description: 'Base documentation version (e.g. "v14", "1.0").',
        },
        toVersion: {
          type: 'string',
          description: 'Target documentation version to compare against (e.g. "v15", "2.0").',
        },
        fromSnapshotId: {
          type: 'string',
          description: 'Base snapshot ID to compare.',
        },
        toSnapshotId: {
          type: 'string',
          description: 'Target snapshot ID to compare.',
        },
        sourceId: {
          type: 'string',
          description: 'Optional documentation source ID filter.',
        },
        from: {
          type: 'string',
          description: 'Alias for fromVersion.',
        },
        to: {
          type: 'string',
          description: 'Alias for toVersion.',
        },
      },
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const fromVersion =
      (typeof args.fromVersion === 'string' ? args.fromVersion : undefined) ||
      (typeof args.from === 'string' ? args.from : undefined);
    const toVersion =
      (typeof args.toVersion === 'string' ? args.toVersion : undefined) ||
      (typeof args.to === 'string' ? args.to : undefined);
    const fromSnapshotId =
      (typeof args.fromSnapshotId === 'string' ? args.fromSnapshotId : undefined) ||
      (typeof args.fromSnapshot === 'string' ? args.fromSnapshot : undefined);
    const toSnapshotId =
      (typeof args.toSnapshotId === 'string' ? args.toSnapshotId : undefined) ||
      (typeof args.toSnapshot === 'string' ? args.toSnapshot : undefined);
    const sourceId =
      (typeof args.sourceId === 'string' ? args.sourceId : undefined) ||
      (typeof args.source === 'string' ? args.source : undefined) ||
      (typeof args.library === 'string' ? args.library : undefined);

    const diffService = ctx.diffService || new DiffService(ctx.repo);
    const { result, markdown } = diffService.diffDocs({
      fromVersion,
      toVersion,
      fromSnapshotId,
      toSnapshotId,
      sourceId,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              markdown,
              data: result,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
