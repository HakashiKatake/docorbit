import type { CallToolResult, McpTool } from '../types.ts';
import { type McpContext, type McpToolHandler, formatToolResponse, formatToolError } from './types.ts';
import { SourceManagementService, type IngestionResult } from '../../core/index.ts';

export class IngestDocTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'ingest_doc',
    description:
      'Ingest, crawl, parse, and index authoritative documentation from any URL or raw content directly into DocOrbit. Tracks documentation sources deterministically in docs.lock. Extracts semantic chunks, OpenAPI endpoints, code examples, and pitfalls. If taskContext is provided, immediately synthesizes and returns an evidence-grounded implementation recipe with exact code and API details.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Documentation target URL to crawl and ingest (e.g. "https://nextjs.org/docs" or "https://support.atlassian.com/...").',
        },
        taskContext: {
          type: 'string',
          description: 'Optional coding task or intent (e.g. "Connect Atlassian Remote MCP" or "Implement Stripe payment element"). If provided, DocOrbit compiles and returns an immediate implementation recipe using the newly ingested docs.',
        },
        maxPages: {
          type: 'number',
          description: 'Maximum number of pages to crawl (default: 20, max: 50).',
        },
        force: {
          type: 'boolean',
          description: 'Force re-fetching and re-crawling documentation even if the source is already tracked (default: false).',
        },
        refresh: {
          type: 'boolean',
          description: 'Alias for force.',
        },
        content: {
          type: 'string',
          description: 'Optional raw markdown/HTML documentation content to index directly without fetching from the web.',
        },
        title: {
          type: 'string',
          description: 'Optional title when ingesting raw content or overriding page title.',
        },
        allowLocalhost: {
          type: 'boolean',
          description: 'Allow crawling localhost endpoints for testing (default: false).',
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
    const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
    const rawContent = typeof args.content === 'string' ? args.content.trim() : '';
    const title = typeof args.title === 'string' ? args.title.trim() : undefined;
    const taskContext = typeof args.taskContext === 'string' ? args.taskContext.trim() : undefined;
    const allowLocalhost = Boolean(args.allowLocalhost);
    const maxPages = typeof args.maxPages === 'number' && args.maxPages > 0
      ? Math.min(args.maxPages, 50)
      : 20;

    if (!rawUrl && !rawContent) {
      return formatToolError('Missing required parameter: provide either "url" to crawl documentation from the web or "content" to index raw documentation.', args);
    }

    try {
      const isForce = Boolean(args.force || args.refresh);
      const sourceManager = ctx.sourceManager || new SourceManagementService(ctx.repo, {
        projectDir: ctx.projectDir || ctx.workspaceRoot,
      });

      const sourceResult = await sourceManager.addOrTrackSource({
        url: rawUrl,
        content: rawContent || undefined,
        title,
        projectDir: ctx.projectDir || ctx.workspaceRoot,
        force: isForce,
        refresh: isForce,
        maxPages,
        allowLocalhost,
        taskContext,
      });

      if (sourceResult.status === 'already_tracked' && !taskContext) {
        const lines: string[] = [
          `# 🛰️ DocOrbit: Documentation Already Tracked`,
          `> **Canonical URL**: \`${sourceResult.url}\` | **Snapshot ID**: \`${sourceResult.snapshotId || 'N/A'}\``,
          ``,
          `The documentation for \`${sourceResult.url}\` is already tracked and up-to-date in \`docs.lock\`.`,
          `- **Snapshot Hash**: \`${sourceResult.snapshotHash || 'N/A'}\``,
          `- **Pages Cached**: ${sourceResult.pageCount ?? 'N/A'}`,
          `- **Tracked At**: ${sourceResult.trackedAt}`,
          `- **Last Checked**: ${sourceResult.updatedAt}`,
          ``,
          `> [!TIP]`,
          `> To force a fresh crawl and check for remote updates, pass \`"force": true\` to \`ingest_doc\`.`,
          ``,
          `### Available Documentation In Workspace`,
          `- Call \`search_docs(query: "...")\` to search across all cached chunks.`,
          `- Call \`find_api(query: "...")\` to inspect endpoints.`,
          `- Call \`get_implementation_context(task: "...")\` to compile an implementation recipe.`,
        ];

        return formatToolResponse(
          lines.join('\n'),
          {
            status: sourceResult.status,
            targetUrl: sourceResult.url,
            sourceId: sourceResult.sourceId,
            snapshotId: sourceResult.snapshotId,
            snapshotHash: sourceResult.snapshotHash,
            pageCount: sourceResult.pageCount,
            docVersion: sourceResult.docVersion,
            trackedAt: sourceResult.trackedAt,
            updatedAt: sourceResult.updatedAt,
            message: sourceResult.message,
          },
          args
        );
      }

      const targetUrl = sourceResult.url;
      const snapshotId = sourceResult.snapshotId || '';
      const pagesCount = sourceResult.pageCount || 1;
      const ingResult = sourceResult.ingestionResult as IngestionResult | undefined;
      const chunksCount = ingResult?.stats?.totalChunks || ctx.repo.countChunks(snapshotId) || 0;
      const codeExamplesCount = ingResult?.stats?.totalCodeExamples || 0;
      const estimatedTokens = ingResult?.stats?.totalEstimatedTokens || 0;
      const durationMs = ingResult?.durationMs || 0;

      const pagesSummary: Array<{ title: string; url: string; tokens: number; codeBlocks: number }> = [];
      if (ingResult?.pages) {
        for (const p of ingResult.pages) {
          pagesSummary.push({
            title: p.title,
            url: p.url,
            tokens: p.estimatedTokens,
            codeBlocks: p.codeExamples.length,
          });
        }
      } else if (rawContent) {
        pagesSummary.push({
          title: title || 'Direct Content Ingestion',
          url: targetUrl,
          tokens: estimatedTokens,
          codeBlocks: codeExamplesCount,
        });
      }

      // If user provided a specific task context, compile an immediate implementation context recipe!
      if (taskContext) {
        const implResult = await ctx.implService.getContext({
          task: taskContext,
          projectPath: ctx.projectDir || ctx.workspaceRoot,
          tokenBudget: 4000,
        });

        const lines: string[] = [
          `# 🛰️ DocOrbit: Ingested & Context Compiled`,
          `> [!NOTE]`,
          `> Successfully ingested **${targetUrl}** and compiled implementation context for: *"${taskContext}"*`,
          ``,
          `### Ingestion Metrics`,
          `- **Pages Ingested**: ${pagesCount}`,
          `- **Chunks Indexed**: ${chunksCount}`,
          `- **Code Examples Extracted**: ${codeExamplesCount}`,
          `- **Estimated Tokens**: ~${estimatedTokens}`,
          `- **Snapshot ID**: \`${snapshotId}\` (${durationMs}ms)`,
          ``,
          `---`,
          ``,
          implResult.markdown,
        ];

        return formatToolResponse(
          lines.join('\n'),
          {
            targetUrl,
            snapshotId,
            taskContext,
            stats: {
              pagesCount,
              chunksCount,
              codeExamplesCount,
              estimatedTokens,
              durationMs,
            },
            implementationContext: implResult,
          },
          args
        );
      }

      // Query any extracted APIs, examples, and pitfalls from the new documentation
      const apiEndpoints = ctx.repo.searchApiEndpoints(targetUrl, { limit: 5 });
      const codeExamples = ctx.repo.searchIndexedExamples(targetUrl, { limit: 3 });
      const pitfalls = ctx.repo.searchPitfalls(targetUrl, { limit: 4 });

      const lines: string[] = [
        `# 🛰️ DocOrbit: Documentation Ingested Successfully`,
        `> **Target**: \`${targetUrl}\` | **Snapshot**: \`${snapshotId}\` | **Duration**: ${durationMs}ms`,
        ``,
        `### Ingestion Statistics`,
        `- **Pages Ingested**: ${pagesCount}`,
        `- **Chunks Indexed**: ${chunksCount}`,
        `- **Code Examples Indexed**: ${codeExamplesCount}`,
        `- **Total Estimated Tokens**: ~${estimatedTokens}`,
        ``,
        `### Ingested Pages Directory`,
      ];

      for (let i = 0; i < pagesSummary.length; i++) {
        const p = pagesSummary[i];
        lines.push(`${i + 1}. **${p.title}** - \`${p.url}\` (~${p.tokens} tokens, ${p.codeBlocks} code snippets)`);
      }

      if (apiEndpoints.length > 0) {
        lines.push(``, `### Discovered API Endpoints`);
        for (const ep of apiEndpoints) {
          lines.push(`- **\`${ep.method.toUpperCase()} ${ep.path}\`**: ${ep.summary || ep.description || 'No description'}`);
        }
      }

      if (codeExamples.length > 0) {
        lines.push(``, `### Extracted Code Patterns`);
        for (const ex of codeExamples) {
          lines.push(`#### ${ex.task} (${ex.language}${ex.framework ? `, ${ex.framework}` : ''})`);
          lines.push('```' + ex.language);
          const safeCode = ex.code.length > 2000 ? ex.code.slice(0, 2000) + '\n// ... [code truncated]' : ex.code;
          lines.push(safeCode);
          lines.push('```\n');
        }
      }

      if (pitfalls.length > 0) {
        lines.push(``, `### Pitfalls & Deprecation Notices`);
        for (const pf of pitfalls) {
          const safeContent = pf.content.length > 1500 ? pf.content.slice(0, 1500) + '... [truncated]' : pf.content;
          lines.push(`- ⚠️ **[${pf.kind.toUpperCase()}] ${pf.title}**: ${safeContent}`);
        }
      }

      lines.push(
        ``,
        `### Recommended Agent Loop Actions`,
        `- **Compile Recipe**: Call \`get_implementation_context(task: "...")\` to assemble a grounded blueprint with ordered steps and validation criteria.`,
        `- **Inspect Endpoints**: Call \`find_api(query: "...")\` for parameters, auth, schemas, and error responses.`,
        `- **Code Examples**: Call \`find_example(task: "...")\` for targeted snippets matching your framework.`,
        `- **Check Constraints**: Call \`find_pitfall(query: "...")\` to avoid deprecations or runtime traps.`
      );

      const safeCodeExamples = codeExamples.map(ex => ex.code.length > 2000 ? { ...ex, code: ex.code.slice(0, 2000) + '... [truncated]' } : ex);
      const safePitfalls = pitfalls.map(pf => pf.content.length > 1500 ? { ...pf, content: pf.content.slice(0, 1500) + '... [truncated]' } : pf);

      return formatToolResponse(
        lines.join('\n'),
        {
          status: sourceResult.status,
          targetUrl,
          sourceId: sourceResult.sourceId,
          snapshotId,
          snapshotHash: sourceResult.snapshotHash,
          trackedAt: sourceResult.trackedAt,
          updatedAt: sourceResult.updatedAt,
          stats: {
            pagesCount,
            chunksCount,
            codeExamplesCount,
            estimatedTokens,
            durationMs,
          },
          pages: pagesSummary,
          apiEndpoints,
          codeExamples: safeCodeExamples,
          pitfalls: safePitfalls,
        },
        args
      );
    } catch (err: unknown) {
      return formatToolError(`DocOrbit Ingestion Failed: ${err instanceof Error ? err.message : String(err)}`, args);
    }
  }
}
