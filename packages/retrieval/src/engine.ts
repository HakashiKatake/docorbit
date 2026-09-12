import type {
  SearchResult,
  SearchOptions,
  ContextPackage,
  ContextOptions,
  ScoringWeights,
  SourceAuthority,
} from '../../shared/src/index.ts';
import { DocOrbitRepository } from '../../storage/src/index.ts';
import { resolveScoringWeights } from './weights.ts';
import { detectQueryIntent } from './intent.ts';
import { scoreChunkCandidate } from './scorer.ts';
import { packContext } from './packer.ts';
import { resolveProjectContext } from '../../workspace/src/index.ts';

export class RetrievalEngine {
  private repository: DocOrbitRepository;
  private defaultWeights: ScoringWeights;

  constructor(repository: DocOrbitRepository, defaultWeights?: Partial<ScoringWeights>) {
    this.repository = repository;
    this.defaultWeights = resolveScoringWeights(defaultWeights);
  }

  /**
   * Deterministic hybrid search combining FTS5 lexical matching, exact phrases,
   * title/breadcrumb boosts, shallow symbol matches, intent weighting, and authority.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const intent = options.intent || detectQueryIntent(query);
    const weights = resolveScoringWeights(options.weights || this.defaultWeights);
    const limit = options.limit || 10;

    let targetDocVersion = options.docVersion;

    if (options.projectDir) {
      const projContext = resolveProjectContext(options.projectDir, query, this.repository);
      if (projContext.matchedDependency && !targetDocVersion) {
        targetDocVersion = projContext.matchedDependency.targetDocVersion;
      }
    }

    // Fetch candidate pool from FTS5 with extra headroom for re-ranking
    const candidates = this.repository.searchChunksFts(query, {
      limit: Math.max(limit * 3, 30),
      snapshotId: options.snapshotId,
      chunkType: options.chunkType,
    });

    if (candidates.length === 0) {
      return [];
    }

    const scoredResults: SearchResult[] = [];

    // Cache source authority per page
    const pageAuthorityCache = new Map<string, SourceAuthority>();

    for (const item of candidates) {
      let authority: SourceAuthority = item.sourceAuthority || 'official';

      // Fallback only if sourceAuthority was not populated by batch join
      if (!item.sourceAuthority) {
        const pageId = item.chunk.pageId;
        if (!pageAuthorityCache.has(pageId)) {
          const page = this.repository.getPage(pageId);
          if (page?.sourceId) {
            const src = this.repository.getSource(page.sourceId);
            if (src?.authority) {
              authority = src.authority;
            }
          }
          pageAuthorityCache.set(pageId, authority);
        } else {
          authority = pageAuthorityCache.get(pageId)!;
        }
      }

      const scored = scoreChunkCandidate({
        chunk: item.chunk,
        ftsRank: item.ftsRank,
        symbols: item.symbols,
        codeSnippets: item.codeSnippets,
        query,
        intent,
        authority,
        targetDocVersion,
        weights,
      });

      if (options.minScore !== undefined && scored.score < options.minScore) {
        continue;
      }

      scoredResults.push(scored);
    }

    // Sort by score descending
    scoredResults.sort((a, b) => b.score - a.score);

    return scoredResults.slice(0, limit);
  }

  /**
   * Assembles a context package tailored for AI coding agents, optimizing for
   * relevance + coverage - redundancy within a strict token budget.
   */
  async buildContext(task: string, options: ContextOptions = {}): Promise<ContextPackage> {
    const intent = options.intent || detectQueryIntent(task);

    // Retrieve broad candidate set
    const candidates = await this.search(task, {
      limit: (options.maxChunks || 15) * 2,
      snapshotId: options.snapshotId,
      docVersion: options.docVersion,
      projectDir: options.projectDir,
      weights: options.weights,
      intent,
    });

    return packContext(task, candidates, intent, options);
  }
}
