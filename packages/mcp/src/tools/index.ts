import type { McpToolHandler } from './types.ts';
import { SearchDocsTool } from './search-docs.ts';
import { GetDocTool } from './get-doc.ts';
import { FindApiTool } from './find-api.ts';
import { FindExampleTool } from './find-example.ts';
import { FindPitfallTool } from './find-pitfall.ts';
import { FindRecipeTool } from './find-recipe.ts';
import { GetVersionTool } from './get-version.ts';
import { ListSourcesTool } from './list-sources.ts';
import { ImplementationContextTool } from './implementation-context.ts';
import { CheckApiTool } from './check-api.ts';
import { DiffDocsTool } from './diff-docs.ts';
import { AnalyzeImpactTool } from './analyze-impact.ts';
import { GetDocumentationMapTool } from './get-docs-map.ts';
import { ExportAgentContextTool } from './export-context.ts';
import { IngestDocTool } from './ingest-doc.ts';

export * from './types.ts';
export {
  SearchDocsTool,
  GetDocTool,
  FindApiTool,
  FindExampleTool,
  FindPitfallTool,
  FindRecipeTool,
  GetVersionTool,
  ListSourcesTool,
  ImplementationContextTool,
  ImplementationContextTool as GetImplementationContextTool,
  CheckApiTool,
  DiffDocsTool,
  AnalyzeImpactTool,
  GetDocumentationMapTool,
  ExportAgentContextTool,
  IngestDocTool,
};

export function createDefaultTools(): Map<string, McpToolHandler> {
  const tools = new Map<string, McpToolHandler>();
  const list: McpToolHandler[] = [
    new SearchDocsTool(),
    new GetDocTool(),
    new FindApiTool(),
    new FindExampleTool(),
    new FindPitfallTool(),
    new FindRecipeTool(),
    new GetVersionTool(),
    new ListSourcesTool(),
    new ImplementationContextTool(),
    new CheckApiTool(),
    new DiffDocsTool(),
    new AnalyzeImpactTool(),
    new GetDocumentationMapTool(),
    new ExportAgentContextTool(),
    new IngestDocTool(),
  ];
  for (const tool of list) {
    tools.set(tool.definition.name, tool);
  }
  return tools;
}

