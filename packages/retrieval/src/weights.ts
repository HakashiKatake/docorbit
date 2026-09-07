import type { ScoringWeights } from '../../shared/src/index.ts';

export const DEFAULT_SCORING_WEIGHTS_V1: ScoringWeights = {
  version: '1.0.0',
  bm25Weight: 1.0,
  exactPhraseBonus: 5.0,
  titleBonus: 8.0,
  sectionPathBonus: 4.0,
  symbolMatchBonus: 10.0,
  intentTypeBonus: 6.0,
  versionBonus: 12.0,
  authorityWeights: {
    official: 1.0,
    community: 0.8,
    third_party: 0.6,
  },
};

export function resolveScoringWeights(overrides?: Partial<ScoringWeights>): ScoringWeights {
  if (!overrides) {
    return { ...DEFAULT_SCORING_WEIGHTS_V1 };
  }
  return {
    ...DEFAULT_SCORING_WEIGHTS_V1,
    ...overrides,
    authorityWeights: {
      ...DEFAULT_SCORING_WEIGHTS_V1.authorityWeights,
      ...(overrides.authorityWeights || {}),
    },
  };
}
