import type { DocOrbitRepository } from '../../../storage/src/index.ts';
import type { ImplementationContextService } from '../../../core/src/index.ts';
import type { WorkspaceResolver } from '../../../workspace/src/index.ts';
import type {
  VerificationService,
  DiffService,
  ImpactAnalysisService,
} from '../../../verification/src/index.ts';
import type { ExportService } from '../../../export/src/index.ts';
import type { CallToolResult, McpTool } from '../types.ts';

export interface McpContext {
  repo: DocOrbitRepository;
  implService: ImplementationContextService;
  implementationService: ImplementationContextService;
  workspaceRoot?: string;
  projectDir?: string;
  resolver?: WorkspaceResolver;
  verificationService?: VerificationService;
  diffService?: DiffService;
  impactService?: ImpactAnalysisService;
  exportService?: ExportService;
}

export interface McpToolHandler {
  readonly definition: McpTool;
  execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult>;
}

export function formatToolResponse(
  markdown: string,
  data?: unknown,
  args?: Record<string, unknown>
): CallToolResult {
  const envFormat = process.env.DOCORBIT_MCP_FORMAT?.toLowerCase();
  const responseFormat = typeof args?.responseFormat === 'string' ? args.responseFormat.toLowerCase() : undefined;
  const directFormat = typeof args?.format === 'string' ? args.format.toLowerCase() : undefined;
  const formatArg = responseFormat ?? (directFormat === 'json' || directFormat === 'markdown' ? directFormat : undefined);

  const isJson = (formatArg ?? envFormat) === 'json';

  if (isJson) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data !== undefined ? { markdown, data } : { markdown }, null, 2),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: markdown,
      },
    ],
  };
}

export function formatToolError(
  message: string,
  args?: Record<string, unknown>
): CallToolResult {
  const envFormat = process.env.DOCORBIT_MCP_FORMAT?.toLowerCase();
  const responseFormat = typeof args?.responseFormat === 'string' ? args.responseFormat.toLowerCase() : undefined;
  const directFormat = typeof args?.format === 'string' ? args.format.toLowerCase() : undefined;
  const formatArg = responseFormat ?? (directFormat === 'json' || directFormat === 'markdown' ? directFormat : undefined);

  const isJson = (formatArg ?? envFormat) === 'json';

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: isJson ? JSON.stringify({ error: message }) : `Error: ${message}`,
      },
    ],
  };
}
