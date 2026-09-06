import type {
  DiscoveredSource,
  SourcePurpose,
  SourceRankResult,
  Target,
} from '../../shared/src/index.ts';
import { validateTargetUrl } from '../../security/src/index.ts';
import { SecureFetcher } from '../../crawler/src/index.ts';
import { createDefaultDiscoveryCoordinator, rankSources } from '../../discovery/src/index.ts';

export interface InspectionReport {
  targetUrl: string;
  target?: Target;
  sourcesDiscovered: DiscoveredSource[];
  recommendations: Record<SourcePurpose, SourceRankResult>;
  summary: {
    totalFound: number;
    machineReadableCount: number;
    officialCount: number;
    hasOpenApi: boolean;
    hasLlmsTxt: boolean;
    hasLlmsFullTxt: boolean;
    hasSkill: boolean;
    hasSitemap: boolean;
  };
}

export async function inspectDocumentation(
  targetUrl: string,
  options: { allowLocalhostForTesting?: boolean; fetcher?: SecureFetcher } = {}
): Promise<InspectionReport> {
  // Validate target URL against SSRF and illegal protocols before probing
  await validateTargetUrl(targetUrl, {
    allowLocalhostForTesting: options.allowLocalhostForTesting,
  });

  const fetcher = options.fetcher || new SecureFetcher({ allowLocalhostForTesting: options.allowLocalhostForTesting });
  const coordinator = createDefaultDiscoveryCoordinator();

  const discovered = await coordinator.discoverAll(targetUrl, fetcher);

  const purposes: SourcePurpose[] = ['navigation', 'conceptual', 'api', 'examples', 'implementation'];
  const recommendations: Partial<Record<SourcePurpose, SourceRankResult>> = {};

  for (const p of purposes) {
    recommendations[p] = rankSources(discovered, p);
  }

  const validSources = discovered.filter(s => s.status === 'valid');

  return {
    targetUrl,
    target: {
      type: 'url',
      value: targetUrl,
      normalizedUrl: targetUrl,
    },
    sourcesDiscovered: discovered,
    recommendations: recommendations as Record<SourcePurpose, SourceRankResult>,
    summary: {
      totalFound: discovered.length,
      machineReadableCount: validSources.filter(s => s.machineReadable).length,
      officialCount: validSources.filter(s => s.authority === 'official').length,
      hasOpenApi: validSources.some(s => s.type === 'openapi'),
      hasLlmsTxt: validSources.some(s => s.type === 'llms_txt'),
      hasLlmsFullTxt: validSources.some(s => s.type === 'llms_full_txt'),
      hasSkill: validSources.some(s => s.type === 'skill'),
      hasSitemap: validSources.some(s => s.type === 'sitemap'),
    },
  };
}
