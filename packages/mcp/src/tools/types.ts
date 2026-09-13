import type { DocOrbitRepository } from '../../../storage/src/index.ts';
import type { ImplementationContextService, SourceManagementService } from '../../../core/src/index.ts';
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
  sourceManager?: SourceManagementService;
}

export interface McpToolHandler {
  readonly definition: McpTool;
  execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult>;
}

export const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 60_000; // Conservative default (~15,000 tokens)
export const ABSOLUTE_MAX_TOOL_OUTPUT_CHARS = 120_000; // Hard upper ceiling (~30,000 tokens)
export const MIN_TOOL_OUTPUT_CHARS = 500; // Minimum allowed floor
export const MAX_TOOL_OUTPUT_CHARS = DEFAULT_MAX_TOOL_OUTPUT_CHARS;

export function getMaxToolOutputChars(): number {
  const envVal = process.env.DOCORBIT_MAX_TOOL_OUTPUT_CHARS;
  if (!envVal) return DEFAULT_MAX_TOOL_OUTPUT_CHARS;
  const parsed = parseInt(envVal, 10);
  if (isNaN(parsed) || parsed <= 0) return DEFAULT_MAX_TOOL_OUTPUT_CHARS;
  return Math.min(Math.max(parsed, MIN_TOOL_OUTPUT_CHARS), ABSOLUTE_MAX_TOOL_OUTPUT_CHARS);
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
  const maxChars = getMaxToolOutputChars();
  const TRUNC_NOTICE = '\n\n... [Response truncated: output exceeded size limit]';

  if (isJson) {
    let safeMd = markdown;
    if (safeMd.length > maxChars) {
      safeMd = safeMd.slice(0, Math.max(0, maxChars - TRUNC_NOTICE.length)) + TRUNC_NOTICE;
    }

    let jsonCandidate: string | null = null;
    try {
      const fullObj = data !== undefined ? { markdown: safeMd, data } : { markdown: safeMd };
      const serialized = JSON.stringify(fullObj, null, 2);
      if (serialized.length <= maxChars) {
        jsonCandidate = serialized;
      }
    } catch {
      // JSON.stringify error (e.g. circular reference)
    }

    if (!jsonCandidate) {
      // Drop bulky data payload, preserve lightweight scalar metadata
      let metadata: Record<string, unknown> | undefined = undefined;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        metadata = {};
        const allowedMetaKeys = ['query', 'task', 'goal', 'count', 'version', 'docVersion', 'targetUrl', 'snapshotId', 'status', 'format', 'library'];
        for (const k of allowedMetaKeys) {
          if (k in data) {
            const val = (data as Record<string, unknown>)[k];
            if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
              metadata[k] = val;
            }
          }
        }
      }

      const truncationReason = `Serialized JSON payload exceeded safety limit of ${maxChars} characters. Bulky data payload omitted.`;
      const truncatedNotice = {
        markdown: safeMd,
        truncated: true,
        truncationReason,
        ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      };

      let serialized = JSON.stringify(truncatedNotice, null, 2);
      if (serialized.length <= maxChars) {
        jsonCandidate = serialized;
      } else {
        // If markdown inside the notice is also large, clamp inner markdown so JSON strictly <= maxChars
        const emptyEnvelope = JSON.stringify({
          markdown: '',
          truncated: true,
          truncationReason,
          ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
        }, null, 2);

        const availableMd = Math.max(50, maxChars - emptyEnvelope.length - TRUNC_NOTICE.length - 100);
        const clampedMd = markdown.slice(0, availableMd) + TRUNC_NOTICE;

        jsonCandidate = JSON.stringify({
          markdown: clampedMd,
          truncated: true,
          truncationReason,
          ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
        }, null, 2);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: jsonCandidate,
        },
      ],
    };
  }

  // Markdown output path
  let safeMarkdown = markdown;
  if (safeMarkdown.length > maxChars) {
    safeMarkdown = safeMarkdown.slice(0, Math.max(0, maxChars - TRUNC_NOTICE.length)) + TRUNC_NOTICE;
  }

  return {
    content: [
      {
        type: 'text',
        text: safeMarkdown,
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
  const maxChars = getMaxToolOutputChars();
  const safeMessage = message.length > maxChars
    ? message.slice(0, Math.max(0, maxChars - 100)) + '... [error truncated]'
    : message;

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: isJson ? JSON.stringify({ error: safeMessage }) : `Error: ${safeMessage}`,
      },
    ],
  };
}
