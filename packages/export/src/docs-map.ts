import type {
  NormalizedPage,
  DocumentChunk,
  ApiEndpoint,
  Pitfall,
  DiscoveredSource,
  DocumentationMapNode,
  DocumentationMapResult,
} from '../../shared/src/index.ts';

export interface DocsMapInputData {
  sources: DiscoveredSource[];
  pages: NormalizedPage[];
  chunks?: DocumentChunk[];
  endpoints?: ApiEndpoint[];
  pitfalls?: Pitfall[];
  docVersion?: string;
}

/**
 * Builds a comprehensive, hierarchical documentation map with token estimates and provenance.
 * Fully deterministic.
 */
export function buildDocumentationMap(data: DocsMapInputData): DocumentationMapResult {
  const pages = [...data.pages];
  const sources = [...data.sources];
  const endpoints = data.endpoints || [];
  const pitfalls = data.pitfalls || [];
  const chunks = data.chunks || [];

  // Group chunks by pageId
  const chunkCountByPage = new Map<string, number>();
  const tokenEstimateByPage = new Map<string, number>();

  for (const chunk of chunks) {
    chunkCountByPage.set(chunk.pageId, (chunkCountByPage.get(chunk.pageId) || 0) + 1);
    const tokens = chunk.tokenEstimate || 0;
    tokenEstimateByPage.set(chunk.pageId, (tokenEstimateByPage.get(chunk.pageId) || 0) + tokens);
  }

  // Group endpoints by pageId
  const apisByPage = new Map<string, string[]>();
  for (const ep of endpoints) {
    if (!apisByPage.has(ep.pageId)) {
      apisByPage.set(ep.pageId, []);
    }
    apisByPage.get(ep.pageId)!.push(`${ep.method.toUpperCase()} ${ep.path}`);
  }

  // Group pitfalls by pageId
  const pitfallsByPage = new Map<string, number>();
  for (const pf of pitfalls) {
    pitfallsByPage.set(pf.pageId, (pitfallsByPage.get(pf.pageId) || 0) + 1);
  }

  // Build page nodes
  const sortedPages = pages.sort((a, b) => a.url.localeCompare(b.url));
  const pageNodes: DocumentationMapNode[] = sortedPages.map(p => {
    const chunkCount = chunkCountByPage.get(p.id) || (p.headings ? Math.max(1, p.headings.length) : 1);
    const estimatedTokens = tokenEstimateByPage.get(p.id) || p.estimatedTokens || 150;
    const pageApis = apisByPage.get(p.id) || [];
    const pagePitfalls = pitfallsByPage.get(p.id) || 0;

    return {
      id: p.id,
      title: p.title || p.url,
      url: p.url,
      version: p.provenance?.versionTag || data.docVersion,
      sourceId: p.sourceId,
      chunkCount,
      estimatedTokens,
      headings: (p.headings || []).map(h => typeof h === 'string' ? h : (h as any).text || ''),
      apis: pageApis.length > 0 ? pageApis : undefined,
      pitfallCount: pagePitfalls > 0 ? pagePitfalls : undefined,
      untrusted: true,
    };
  });

  const totalPages = pageNodes.length;
  const totalChunks = pageNodes.reduce((acc, p) => acc + p.chunkCount, 0);
  const totalEstimatedTokens = pageNodes.reduce((acc, p) => acc + p.estimatedTokens, 0);

  // Group by source
  const sourceSummaries = sources.map(s => {
    const sourcePages = pageNodes.filter(p => p.sourceId === s.id);
    return {
      id: s.id,
      url: s.url,
      pageCount: sourcePages.length,
      chunkCount: sourcePages.reduce((acc, p) => acc + p.chunkCount, 0),
    };
  });

  // Generate Markdown representation
  const lines: string[] = [];
  lines.push('# Documentation Map & Token Footprint');
  lines.push('');
  lines.push(`- **Total Indexed Sources**: ${sources.length}`);
  lines.push(`- **Total Pages**: ${totalPages}`);
  lines.push(`- **Total Chunks**: ${totalChunks}`);
  lines.push(`- **Total Estimated Tokens**: ~${totalEstimatedTokens.toLocaleString()}`);
  lines.push('- **Security Boundary**: `untrusted: true`');
  lines.push('');

  lines.push('## Documentation Tree');
  lines.push('');

  for (const s of sources) {
    lines.push(`### Source: \`${s.url}\``);
    const sourcePages = pageNodes.filter(p => p.sourceId === s.id);
    if (sourcePages.length === 0) {
      lines.push('  - *(No pages indexed under this source)*');
    } else {
      for (const p of sourcePages) {
        const tokenBadge = `~${p.estimatedTokens} tokens`;
        const chunkBadge = `${p.chunkCount} chunks`;
        const verBadge = p.version ? ` [version: ${p.version}]` : '';
        lines.push(`  - **[${p.title}](${p.url})** (${chunkBadge}, ${tokenBadge})${verBadge}`);

        if (p.headings && p.headings.length > 0) {
          for (const h of p.headings.slice(0, 5)) {
            lines.push(`    - section: ${h}`);
          }
          if (p.headings.length > 5) {
            lines.push(`    - ... and ${p.headings.length - 5} more sections`);
          }
        }

        if (p.apis && p.apis.length > 0) {
          lines.push(`    - *APIs: ${p.apis.join(', ')}*`);
        }
        if (p.pitfallCount) {
          lines.push(`    - *Warnings/Pitfalls: ${p.pitfallCount} recorded*`);
        }
      }
    }
    lines.push('');
  }

  return {
    totalSources: sources.length,
    totalPages,
    totalChunks,
    totalEstimatedTokens,
    sources: sourceSummaries,
    pages: pageNodes,
    markdownTree: lines.join('\n'),
    untrusted: true,
  };
}
