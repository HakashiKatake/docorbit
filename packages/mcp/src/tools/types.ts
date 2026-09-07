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
