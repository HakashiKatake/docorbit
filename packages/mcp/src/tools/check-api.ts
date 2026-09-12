import type { CallToolResult, McpTool } from '../types.ts';
import { type McpContext, type McpToolHandler, formatToolResponse, formatToolError } from './types.ts';
import { VerificationService } from '../../../verification/src/index.ts';

export class CheckApiTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'check_api',
    description: 'Verify agent/generated code against indexed OpenAPI schemas and documentation. Detects invalid endpoints, wrong HTTP methods, missing required parameters, deprecations, removed APIs, version syntax conflicts, and response assumptions. Distinguishes verified, warning, mismatch, and insufficient_evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The generated code snippet, route handler, or API client call to verify.',
        },
        language: {
          type: 'string',
          description: 'Programming language of the code (e.g. "typescript", "javascript", "python", "curl").',
        },
        library: {
          type: 'string',
          description: 'Target library or SDK name (e.g. "stripe", "next").',
        },
        version: {
          type: 'string',
          description: 'Target documentation/API version (e.g. "v14", "v15", "1.0"). If omitted, project version is auto-detected.',
        },
        project: {
          type: 'string',
          description: 'Workspace root directory to auto-resolve project dependencies and versions.',
        },
        filePath: {
          type: 'string',
          description: 'Optional path of the file being verified for context.',
        },
        snippet: {
          type: 'string',
          description: 'Alternative alias for code snippet.',
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
    const code =
      (typeof args.code === 'string' ? args.code.trim() : '') ||
      (typeof args.snippet === 'string' ? args.snippet.trim() : '') ||
      (typeof args.codeSnippet === 'string' ? args.codeSnippet.trim() : '') ||
      (typeof args.symbol === 'string' ? args.symbol.trim() : '') ||
      (typeof args.query === 'string' ? args.query.trim() : '');

    if (!code) {
      return formatToolError('Missing required argument: code (or snippet)', args);
    }

    const language = typeof args.language === 'string' ? args.language : undefined;
    const library = typeof args.library === 'string' ? args.library : undefined;
    const version = typeof args.version === 'string' ? args.version : undefined;
    const filePath = typeof args.filePath === 'string' ? args.filePath : undefined;
    const projectDir =
      (typeof args.projectDir === 'string' ? args.projectDir : undefined) ||
      (typeof args.project === 'string' ? args.project : undefined) ||
      ctx.projectDir ||
      ctx.workspaceRoot;

    const service = ctx.verificationService || new VerificationService(ctx.repo);
    const { result, markdown } = service.verifyCode({
      code,
      language,
      library,
      version,
      projectDir,
      filePath,
    });

    return formatToolResponse(markdown, result, args);
  }
}
