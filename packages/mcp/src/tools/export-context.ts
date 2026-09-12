import type { CallToolResult, McpTool } from '../types.ts';
import { type McpContext, type McpToolHandler, formatToolResponse } from './types.ts';
import { ExportService } from '../../../export/src/index.ts';
import type { ExportFormat } from '../../../shared/src/index.ts';

export class ExportAgentContextTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'export_agent_context',
    description: 'Deterministically generate and export agent-native documentation context files (AGENTS.md, CLAUDE.md, skill.md, llms.txt, docs-map.md) grounded in project dependency versions and authoritative documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['agents.md', 'claude.md', 'skill.md', 'llms.txt', 'docs-map.md'],
          description: 'Target agent file format to generate (default: "agents.md").',
        },
        docVersion: {
          type: 'string',
          description: 'Optional target documentation version (e.g. "v14", "v15").',
        },
        projectDir: {
          type: 'string',
          description: 'Optional project directory for resolving workspace dependency versions.',
        },
        targetSource: {
          type: 'string',
          description: 'Optional library or skill name label.',
        },
        responseFormat: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Response output format: "markdown" (default, raw exported content) or "json" (structured metadata).',
        },
      },
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const rawFormat =
      (typeof args.format === 'string' ? args.format.toLowerCase() : '') ||
      (typeof args.type === 'string' ? args.type.toLowerCase() : '') ||
      'agents.md';
    const validFormats: ExportFormat[] = ['agents.md', 'claude.md', 'skill.md', 'llms.txt', 'docs-map.md'];
    const format = validFormats.includes(rawFormat as ExportFormat) ? (rawFormat as ExportFormat) : 'agents.md';

    const docVersion = typeof args.docVersion === 'string' ? args.docVersion : undefined;
    const projectDir = typeof args.projectDir === 'string' ? args.projectDir : ctx.projectDir || ctx.workspaceRoot;
    const targetSource = typeof args.targetSource === 'string' ? args.targetSource : undefined;

    const exportService = ctx.exportService || new ExportService(ctx.repo);
    const result = await exportService.generateExport({
      format,
      docVersion,
      projectDir,
      targetSource,
    });

    return formatToolResponse(
      result.content,
      {
        format: result.format,
        metadata: result.metadata,
        tokenEstimate: result.metadata.tokenEstimate,
        untrusted: true,
      },
      args
    );
  }
}
