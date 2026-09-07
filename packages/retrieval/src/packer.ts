import type {
  SearchResult,
  DocumentChunk,
  ContextPackage,
  ContextOptions,
  QueryIntent,
} from '../../shared/src/index.ts';

export function packContext(
  task: string,
  candidates: SearchResult[],
  detectedIntent: QueryIntent,
  options: ContextOptions = {}
): ContextPackage {
  const tokenBudget = options.tokenBudget || 3000;
  const maxChunks = options.maxChunks || 15;
  const redundancyPenalty = options.redundancyPenalty ?? 0.35;

  const selectedChunks: DocumentChunk[] = [];
  const selectedChunkIds = new Set<string>();
  const selectedSectionCounts = new Map<string, number>();
  const selectedPages = new Set<string>();
  const sourcesSet = new Set<string>();
  const warnings: string[] = [];

  let totalEstimatedTokens = 0;
  const remainingCandidates = [...candidates];

  while (remainingCandidates.length > 0 && selectedChunks.length < maxChunks) {
    let bestIdx = -1;
    let bestUtility = -Infinity;

    for (let i = 0; i < remainingCandidates.length; i++) {
      const candidate = remainingCandidates[i];
      const chunk = candidate.chunk;

      // Check if it strictly fits within the remaining token budget
      if (totalEstimatedTokens + chunk.tokenEstimate > tokenBudget) {
        continue;
      }


      const sectionKey = `${chunk.pageId}:${chunk.sectionPath.join(' > ')}`;
      const sectionOverlap = selectedSectionCounts.get(sectionKey) || 0;

      // Penalize multiple chunks from the exact same section to encourage diversity/coverage
      const redundancyFactor = Math.pow(1 - redundancyPenalty, sectionOverlap);

      // Reward discovering new pages / sections (coverage bonus)
      const coverageMultiplier = selectedPages.has(chunk.pageId) ? 1.0 : 1.25;

      const utility = candidate.score * redundancyFactor * coverageMultiplier;

      if (utility > bestUtility) {
        bestUtility = utility;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      // No remaining candidate fits within the remaining token budget
      break;
    }

    const chosen = remainingCandidates.splice(bestIdx, 1)[0];
    const chunk = chosen.chunk;

    selectedChunks.push(chunk);
    selectedChunkIds.add(chunk.id);

    const sectionKey = `${chunk.pageId}:${chunk.sectionPath.join(' > ')}`;
    selectedSectionCounts.set(sectionKey, (selectedSectionCounts.get(sectionKey) || 0) + 1);
    selectedPages.add(chunk.pageId);

    if (chunk.provenance?.targetUrl) {
      sourcesSet.add(chunk.provenance.targetUrl);
    } else if (chunk.provenance?.sourceUrl) {
      sourcesSet.add(chunk.provenance.sourceUrl);
    }

    totalEstimatedTokens += chunk.tokenEstimate;

    // If chunk is a warning, register it in top-level warnings
    if (chunk.chunkType === 'warning') {
      warnings.push(`[${chunk.sectionPath.join(' > ')}]: ${chunk.content.slice(0, 150)}...`);
    }
  }

  // Group chunks by page in order of page first appearance in selectedChunks (most relevant page first)
  const pageOrder = new Map<string, number>();
  for (let i = 0; i < selectedChunks.length; i++) {
    const pId = selectedChunks[i].pageId;
    if (!pageOrder.has(pId)) {
      pageOrder.set(pId, pageOrder.size);
    }
  }

  const sortedChunks = [...selectedChunks].sort((a, b) => {
    const pOrderA = pageOrder.get(a.pageId) ?? 0;
    const pOrderB = pageOrder.get(b.pageId) ?? 0;
    if (pOrderA !== pOrderB) return pOrderA - pOrderB;
    return a.ordinal - b.ordinal;
  });

  // Build agent-facing Markdown package
  const lines: string[] = [];
  lines.push(`# Context Package: ${task}`);
  lines.push(`- **Detected Intent**: \`${detectedIntent}\``);
  lines.push(`- **Estimated Tokens**: ~${totalEstimatedTokens} / ${tokenBudget} tokens (heuristic estimate)`);
  lines.push(`- **Sources Included**: ${sourcesSet.size > 0 ? Array.from(sourcesSet).map(s => `[${s}](${s})`).join(', ') : 'Local documentation'}`);

  if (warnings.length > 0) {
    lines.push('\n> [!WARNING]');
    lines.push('> **Relevant Advisories & Caveats**:');
    for (const w of warnings) {
      lines.push(`> - ${w}`);
    }
  }

  lines.push('\n---\n');

  for (const chunk of sortedChunks) {
    const breadcrumb = chunk.sectionPath.length > 0 ? chunk.sectionPath.join(' > ') : (chunk.title || 'General');
    lines.push(`### ${breadcrumb}`);
    lines.push(`*Type: \`${chunk.chunkType}\` | Est. Tokens: ~${chunk.tokenEstimate}*`);
    lines.push('\n' + chunk.content.trim() + '\n');
    if (chunk.provenance?.sourceUrl) {
      lines.push(`*Source: ${chunk.provenance.sourceUrl}*\n`);
    }
    lines.push('---\n');
  }

  const markdown = lines.join('\n');

  return {
    task,
    detectedIntent,
    totalEstimatedTokens,
    tokenBudget,
    chunks: sortedChunks,
    markdown,
    sources: Array.from(sourcesSet),
    warnings,
  };
}
