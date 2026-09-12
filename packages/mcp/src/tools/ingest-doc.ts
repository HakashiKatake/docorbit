import type { CallToolResult, McpTool } from '../types.ts';
import { type McpContext, type McpToolHandler, formatToolResponse, formatToolError } from './types.ts';
import { IngestionPipeline } from '../../../core/src/index.ts';
import { buildNormalizedPage, slicePageIntoChunks } from '../../../normalizer/src/index.ts';

export class IngestDocTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'ingest_doc',
    description:
      'Ingest, crawl, parse, and index authoritative documentation from any URL or raw content directly into DocOrbit. Extracts semantic chunks, OpenAPI endpoints, code examples, and pitfalls. If taskContext is provided, immediately synthesizes and returns an evidence-grounded implementation recipe with exact code and API details.',
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
      let targetUrl = rawUrl;
      let snapshotId = '';
      let pagesCount = 0;
      let chunksCount = 0;
      let codeExamplesCount = 0;
      let estimatedTokens = 0;
      let durationMs = 0;
      const pagesSummary: Array<{ title: string; url: string; tokens: number; codeBlocks: number }> = [];

      if (rawContent) {
        const startTime = Date.now();
        targetUrl = rawUrl || 'local://direct-content';
        const sourceId = ctx.repo.saveSource({
          url: targetUrl,
          type: 'web',
          discoveredBy: 'direct',
          status: 'valid',
          confidence: 1.0,
          authority: 'official',
          machineReadable: false,
        });

        snapshotId = ctx.repo.createSnapshot(sourceId, {
          targetUrl,
          pageCount: 1,
          ingestedAt: new Date().toISOString(),
        });

        const page = buildNormalizedPage({
          sourceId,
          url: targetUrl,
          rawContent,
          contentType: 'text/markdown',
          sourceUrl: targetUrl,
          targetUrl,
          title: title || 'Direct Content Ingestion',
          discoveredBy: 'direct',
          fetchedAt: new Date().toISOString(),
        });

        ctx.repo.savePage(page);
        const slicing = slicePageIntoChunks(page, snapshotId);
        ctx.repo.saveChunks(slicing.chunks, slicing.relationships, slicing.codeSnippets, slicing.symbols);

        pagesCount = 1;
        chunksCount = slicing.chunks.length;
        codeExamplesCount = page.codeExamples.length;
        estimatedTokens = page.estimatedTokens;
        durationMs = Date.now() - startTime;
        pagesSummary.push({
          title: page.title,
          url: page.url,
          tokens: page.estimatedTokens,
          codeBlocks: page.codeExamples.length,
        });
      } else {
        const pipeline = new IngestionPipeline(ctx.repo, {
          allowLocalhostForTesting: allowLocalhost,
          crawlerConfig: {
            maxPages,
          },
        });

        const result = await pipeline.ingest(rawUrl);
        targetUrl = result.targetUrl;
        snapshotId = result.snapshotId;
        pagesCount = result.stats.totalPages;
        chunksCount = result.stats.totalChunks;
        codeExamplesCount = result.stats.totalCodeExamples;
        estimatedTokens = result.stats.totalEstimatedTokens;
        durationMs = result.durationMs;

        for (const p of result.pages) {
          pagesSummary.push({
            title: p.title,
            url: p.url,
            tokens: p.estimatedTokens,
            codeBlocks: p.codeExamples.length,
          });
        }
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
          lines.push(ex.code);
          lines.push('```\n');
        }
      }

      if (pitfalls.length > 0) {
        lines.push(``, `### Pitfalls & Deprecation Notices`);
        for (const pf of pitfalls) {
          lines.push(`- ⚠️ **[${pf.kind.toUpperCase()}] ${pf.title}**: ${pf.content}`);
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

      return formatToolResponse(
        lines.join('\n'),
        {
          targetUrl,
          snapshotId,
          stats: {
            pagesCount,
            chunksCount,
            codeExamplesCount,
            estimatedTokens,
            durationMs,
          },
          pages: pagesSummary,
          apiEndpoints,
          codeExamples,
          pitfalls,
        },
        args
      );
    } catch (err: unknown) {
      return formatToolError(`DocOrbit Ingestion Failed: ${err instanceof Error ? err.message : String(err)}`, args);
    }
  }
}
