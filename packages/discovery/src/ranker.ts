import type {
  DiscoveredSource,
  SourcePurpose,
  SourceRankResult,
  SourceType,
} from '../../shared/src/index.ts';

const PURPOSE_TYPE_WEIGHTS: Record<SourcePurpose, Record<SourceType, number>> = {
  navigation: {
    llms_txt: 1.0,
    sitemap: 0.9,
    web: 0.7,
    llms_full_txt: 0.6,
    markdown: 0.5,
    skill: 0.45,
    openapi: 0.4,
    github: 0.3,
  },
  conceptual: {
    markdown: 1.0,
    llms_full_txt: 0.95,
    llms_txt: 0.85,
    web: 0.75,
    skill: 0.6,
    openapi: 0.5,
    github: 0.45,
    sitemap: 0.3,
  },
  api: {
    openapi: 1.0,
    markdown: 0.7,
    llms_full_txt: 0.65,
    web: 0.5,
    llms_txt: 0.4,
    github: 0.35,
    skill: 0.3,
    sitemap: 0.2,
  },
  examples: {
    github: 1.0,
    markdown: 0.85,
    llms_full_txt: 0.8,
    web: 0.6,
    skill: 0.5,
    llms_txt: 0.45,
    openapi: 0.4,
    sitemap: 0.2,
  },
  implementation: {
    skill: 1.0,
    markdown: 0.9,
    llms_txt: 0.85,
    llms_full_txt: 0.8,
    web: 0.65,
    openapi: 0.6,
    github: 0.55,
    sitemap: 0.2,
  },
};

const AUTHORITY_WEIGHTS = {
  official: 1.0,
  community: 0.8,
  third_party: 0.6,
};

function scoreSource(source: DiscoveredSource, purpose: SourcePurpose): number {
  if (source.status === 'unreachable') return 0;
  if (source.status === 'invalid') return 0.05;

  const typeWeights = PURPOSE_TYPE_WEIGHTS[purpose] || PURPOSE_TYPE_WEIGHTS.conceptual;
  const baseWeight = typeWeights[source.type] || 0.4;
  const authorityWeight = AUTHORITY_WEIGHTS[source.authority] || 0.6;
  const machineBonus = source.machineReadable ? 0.05 : 0.0;

  const score = (baseWeight * authorityWeight + machineBonus) * source.confidence;
  return Math.min(1.0, Math.max(0.0, score));
}

/**
 * Ranks discovered sources based on the intended purpose:
 * navigation, conceptual, api, examples, or implementation.
 */
export function rankSources(
  sources: DiscoveredSource[],
  purpose: SourcePurpose = 'conceptual'
): SourceRankResult {
  if (!sources || sources.length === 0) {
    return {
      purpose,
      recommended: null,
      ranked: [],
      rationale: `No sources available to rank for purpose "${purpose}".`,
    };
  }

  const scored = sources.map(s => ({
    source: s,
    score: scoreSource(s, purpose),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.source.url.localeCompare(b.source.url);
  });

  const ranked = scored.map(item => item.source);
  const recommended = ranked.find(s => s.status === 'valid') || null;

  let rationale = `Ranked ${ranked.length} source(s) for purpose "${purpose}".`;
  if (recommended) {
    rationale += ` Recommended "${recommended.url}" (${recommended.type}, authority: ${recommended.authority}, machine-readable: ${recommended.machineReadable}).`;
  } else {
    rationale += ' No valid candidate sources found.';
  }

  return {
    purpose,
    recommended,
    ranked,
    rationale,
  };
}
