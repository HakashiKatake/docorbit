import type {
  DocumentChunk,
  SymbolReference,
  ChunkCode,
  ScoringWeights,
  QueryIntent,
  SourceAuthority,
  SearchResult,
} from '../../shared/src/index.ts';

export interface ScoreCandidateInput {
  chunk: DocumentChunk;
  ftsRank: number;
  symbols: SymbolReference[];
  codeSnippets: ChunkCode[];
  query: string;
  intent: QueryIntent;
  authority?: SourceAuthority;
  targetDocVersion?: string;
  weights: ScoringWeights;
}

export function scoreChunkCandidate(input: ScoreCandidateInput): SearchResult {
  const { chunk, ftsRank, symbols, codeSnippets, query, intent, authority = 'official', targetDocVersion, weights } = input;

  const matchReasons: string[] = [];
  const queryLower = query.toLowerCase().trim();
  const queryTokens = queryLower
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);

  // 1. Base BM25 score from FTS5 (FTS5 rank is negative where smaller = more relevant)
  const normalizedBm25 = Math.max(0.1, -ftsRank);
  let totalScore = normalizedBm25 * weights.bm25Weight;
  matchReasons.push(`BM25 base (${normalizedBm25.toFixed(2)})`);

  // 2. Exact phrase match in content
  if (chunk.content.toLowerCase().includes(queryLower)) {
    totalScore += weights.exactPhraseBonus;
    matchReasons.push(`Exact phrase match (+${weights.exactPhraseBonus})`);
  }

  // 3. Title match
  const titleLower = (chunk.title || '').toLowerCase();
  const titleMatches = queryTokens.filter(t => titleLower.includes(t));
  if (titleMatches.length > 0) {
    const boost = weights.titleBonus * (titleMatches.length / queryTokens.length);
    totalScore += boost;
    matchReasons.push(`Title match [${titleMatches.join(', ')}] (+${boost.toFixed(1)})`);
  }

  // 4. Section path match
  const pathString = chunk.sectionPath.join(' ').toLowerCase();
  const pathMatches = queryTokens.filter(t => pathString.includes(t));
  if (pathMatches.length > 0) {
    const boost = weights.sectionPathBonus * (pathMatches.length / queryTokens.length);
    totalScore += boost;
    matchReasons.push(`Section breadcrumbs match [${pathMatches.join(', ')}] (+${boost.toFixed(1)})`);
  }

  // 5. Symbol match (shallow deterministic regex symbols)
  const matchedSymbols = symbols.filter(s => {
    const symLower = s.name.toLowerCase();
    return queryLower.includes(symLower) || symLower.includes(queryLower);
  });
  if (matchedSymbols.length > 0) {
    totalScore += weights.symbolMatchBonus;
    matchReasons.push(`Symbol match [${matchedSymbols.map(s => s.name).join(', ')}] (+${weights.symbolMatchBonus})`);
  }

  // 6. Query intent alignment
  let intentBoost = 0;
  if (intent === 'api' && chunk.chunkType === 'api') {
    intentBoost = weights.intentTypeBonus;
  } else if (intent === 'examples' && (chunk.chunkType === 'example' || chunk.chunkType === 'code')) {
    intentBoost = weights.intentTypeBonus;
  } else if (intent === 'troubleshooting' && (chunk.chunkType === 'warning' || /error|exception|fail|status|code/i.test(chunk.content))) {
    intentBoost = weights.intentTypeBonus;
  } else if (intent === 'implementation' && (chunk.chunkType === 'mixed' || chunk.chunkType === 'example')) {
    intentBoost = weights.intentTypeBonus;
  } else if (intent === 'conceptual' && chunk.chunkType === 'prose') {
    intentBoost = weights.intentTypeBonus;
  } else if (intent === 'configuration' && (symbols.some(s => s.kind === 'config') || chunk.chunkType === 'prose')) {
    intentBoost = weights.intentTypeBonus;
  }

  if (intentBoost > 0) {
    totalScore += intentBoost;
    matchReasons.push(`Intent alignment '${intent}' for chunkType '${chunk.chunkType}' (+${intentBoost})`);
  }

  // 7. Documentation version boosting & nuance
  if (targetDocVersion && chunk.docVersion) {
    const chunkVerClean = chunk.docVersion.replace(/^[v=]/, '');
    const targetVerClean = targetDocVersion.replace(/^[v=]/, '');

    const chunkMajor = chunkVerClean.split('.')[0];
    const targetMajor = targetVerClean.split('.')[0];

    if (chunkVerClean === targetVerClean || chunk.docVersion === targetDocVersion) {
      // Exact version match
      totalScore += weights.versionBonus;
      matchReasons.push(`Target doc version exact match [${chunk.docVersion}] (+${weights.versionBonus})`);
    } else if (chunkMajor === targetMajor) {
      // Same major version (e.g. target 14.2.3, chunk v14 or 14.1)
      const majorBoost = weights.versionBonus * 0.85;
      totalScore += majorBoost;
      matchReasons.push(`Target doc major match [${chunk.docVersion}] (+${majorBoost.toFixed(1)})`);
    } else if (
      chunk.docVersion === 'latest' ||
      chunk.docVersion === 'stable' ||
      chunk.docVersion === 'current'
    ) {
      // Unversioned / latest documentation: neutral supplemental context
      matchReasons.push(`Supplemental unversioned/latest documentation [${chunk.docVersion}]`);
    } else {
      // Evidence of major version incompatibility (e.g. target v14 vs chunk v16)
      const penalty = weights.versionBonus * 0.5;
      totalScore -= penalty;
      matchReasons.push(`Version major discrepancy [chunk ${chunk.docVersion} vs target ${targetDocVersion}] (-${penalty.toFixed(1)})`);
    }
  }

  // 8. Authority weighting
  const authMultiplier = weights.authorityWeights[authority] ?? 1.0;
  totalScore *= authMultiplier;
  if (authMultiplier !== 1.0) {
    matchReasons.push(`Authority weighting: x${authMultiplier}`);
  }

  return {
    chunk,
    score: parseFloat(totalScore.toFixed(3)),
    matchReasons,
    symbols,
    codeSnippets,
  };
}
