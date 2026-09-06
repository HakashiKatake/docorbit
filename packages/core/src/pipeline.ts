import type {
  DiscoveredSource,
  NormalizedPage,
  CrawlerConfig,
  CrawlPolicy,
  Target,
  SourcePurpose,
} from '../../shared/src/index.ts';
import { validateTargetUrl } from '../../security/src/index.ts';
import { SecureFetcher, DEFAULT_CRAWLER_CONFIG } from '../../crawler/src/index.ts';
import { createDefaultDiscoveryCoordinator, rankSources } from '../../discovery/src/index.ts';
import { buildNormalizedPage, parseLlmsTxt, isValidLlmsTxt } from '../../normalizer/src/index.ts';
import { DocRouterRepository } from '../../storage/src/index.ts';

export interface IngestionOptions {
  crawlerConfig?: Partial<CrawlerConfig>;
  crawlPolicy?: Partial<CrawlPolicy>;
  allowLocalhostForTesting?: boolean;
}

export interface IngestionResult {
  targetUrl: string;
  target?: Target;
  primarySourceId: string;
  sourcesDiscovered: DiscoveredSource[];
  selectedSources: Array<{
    purpose: SourcePurpose;
    sourceId: string;
  }>;
  pages: NormalizedPage[];
  pagesDiscovered: number;
  pagesFetched: number;
  pagesStored: number;
  snapshotId: string;
  warnings: string[];
  errors: Array<{
    url: string;
    error: string;
  }>;
  durationMs: number;
  stats: {
    totalPages: number;
    totalBytes: number;
    totalEstimatedTokens: number;
    totalCodeExamples: number;
    machineReadableSources: number;
  };
}

export class IngestionPipeline {
  private repository: DocRouterRepository;
  private fetcher: SecureFetcher;
  private config: CrawlerConfig;
  private policy: CrawlPolicy;
  private allowLocalhostForTesting: boolean;

  constructor(repository: DocRouterRepository, options: IngestionOptions = {}) {
    this.repository = repository;
    this.config = {
      ...DEFAULT_CRAWLER_CONFIG,
      ...options.crawlerConfig,
    };
    this.allowLocalhostForTesting = options.allowLocalhostForTesting ?? false;
    this.policy = {
      purpose: 'conceptual',
      maxPages: this.config.maxPages,
      maxDepth: this.config.maxDepth || 2,
      followLlmsReferences: true,
      followExternalDomains: false,
      ...options.crawlPolicy,
    };
    this.fetcher = new SecureFetcher({
      timeoutMs: this.config.timeoutMs,
      maxBytes: this.config.maxBytesPerResponse,
      maxRedirects: this.config.maxRedirects,
      userAgent: this.config.userAgent,
      allowLocalhostForTesting: this.allowLocalhostForTesting,
    });
  }

  async ingest(targetUrl: string): Promise<IngestionResult> {
    const startTime = Date.now();

    // 1. SSRF & Protocol validation before making any discovery probes
    await validateTargetUrl(targetUrl, {
      allowLocalhostForTesting: this.allowLocalhostForTesting,
    });

    const coordinator = createDefaultDiscoveryCoordinator();
    const discovered = await coordinator.discoverAll(targetUrl, this.fetcher);

    const sourceIds: Record<string, string> = {};
    for (const s of discovered) {
      const id = this.repository.saveSource(s);
      sourceIds[s.url] = id;
    }

    const conceptualRank = rankSources(discovered, 'conceptual');
    const apiRank = rankSources(discovered, 'api');

    const primarySource = conceptualRank.recommended || discovered[0];
    const primarySourceId = primarySource
      ? (sourceIds[primarySource.url] || this.repository.saveSource(primarySource))
      : this.repository.saveSource({
          url: targetUrl,
          type: 'web',
          discoveredBy: 'direct',
          status: 'valid',
          confidence: 1.0,
          authority: 'official',
          machineReadable: false,
        });

    const purposes: SourcePurpose[] = ['navigation', 'conceptual', 'api', 'examples', 'implementation'];
    const selectedSources = purposes.map(p => {
      const ranked = rankSources(discovered, p);
      return {
        purpose: p,
        sourceId: ranked.recommended ? (sourceIds[ranked.recommended.url] || primarySourceId) : primarySourceId,
      };
    });

    const queue: Array<{ url: string; depth: number }> = [];
    const visited = new Set<string>();
    const ingestedPages: NormalizedPage[] = [];
    const warnings: string[] = [];
    const errors: Array<{ url: string; error: string }> = [];
    let pagesDiscovered = 0;

    const enqueue = (url: string, depth: number) => {
      try {
        const parsed = new URL(url);
        const normalized = `${parsed.origin}${parsed.pathname}`;
        pagesDiscovered++;
        if (depth > this.policy.maxDepth) return;
        if (!visited.has(normalized) && queue.length < this.policy.maxPages) {
          queue.push({ url: normalized, depth });
        }
      } catch {
        // Ignore
      }
    };

    // 1. Prioritize targetUrl as the primary entry point (depth: 0)
    enqueue(targetUrl, 0);

    // 2. If an OpenAPI spec is available, enqueue it (depth: 0)
    if (apiRank.recommended && apiRank.recommended.type === 'openapi' && apiRank.recommended.url !== targetUrl) {
      enqueue(apiRank.recommended.url, 0);
    }

    // 3. If llms.txt or llms-full.txt is available, enqueue it (depth: 0)
    const llmsFull = discovered.find(s => s.type === 'llms_full_txt' && s.status === 'valid');
    const llms = discovered.find(s => s.type === 'llms_txt' && s.status === 'valid');

    if (llmsFull && llmsFull.url !== targetUrl) {
      enqueue(llmsFull.url, 0);
    } else if (llms && llms.url !== targetUrl) {
      enqueue(llms.url, 0);
    }

    if (primarySource && primarySource.url !== targetUrl) {
      enqueue(primarySource.url, 0);
    }

    const targetOrigin = new URL(targetUrl).origin;

    while (queue.length > 0 && ingestedPages.length < this.policy.maxPages) {
      const item = queue.shift()!;
      const currentUrl = item.url;
      const currentDepth = item.depth;

      if (visited.has(currentUrl)) continue;
      visited.add(currentUrl);

      try {
        const res = await this.fetcher.fetch(currentUrl);
        if (res.status < 200 || res.status >= 300) {
          errors.push({ url: currentUrl, error: `HTTP status ${res.status}` });
          continue;
        }

        const page = buildNormalizedPage({
          sourceId: primarySourceId,
          url: res.finalUrl || currentUrl,
          rawContent: res.body,
          contentType: res.contentType,
          sourceUrl: primarySource?.url || targetUrl,
          targetUrl,
          discoveredBy: primarySource?.discoveredBy || 'direct',
          fetchedAt: new Date().toISOString(),
        });

        this.repository.savePage(page);
        ingestedPages.push(page);

        // Subpage link discovery
        if (isValidLlmsTxt(res.body)) {
          if (this.policy.followLlmsReferences && currentDepth < this.policy.maxDepth) {
            const llmsDoc = parseLlmsTxt(res.body, currentUrl);
            for (const sec of llmsDoc.sections) {
              for (const lnk of sec.links) {
                if (ingestedPages.length + queue.length < this.policy.maxPages) {
                  try {
                    const parsedLnk = new URL(lnk.url);
                    if (this.policy.followExternalDomains || parsedLnk.origin === targetOrigin) {
                      enqueue(lnk.url, currentDepth + 1);
                    }
                  } catch {
                    // Ignore
                  }
                }
              }
            }
          }
        } else {
          if (currentDepth < this.policy.maxDepth) {
            for (const lnk of page.links) {
              if (ingestedPages.length + queue.length < this.policy.maxPages) {
                try {
                  const linkUrl = new URL(lnk.url);
                  if (this.policy.followExternalDomains || linkUrl.origin === targetOrigin) {
                    enqueue(lnk.url, currentDepth + 1);
                  }
                } catch {
                  // Ignore
                }
              }
            }
          }
        }
      } catch (err: unknown) {
        errors.push({ url: currentUrl, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const snapshotId = this.repository.createSnapshot(primarySourceId, {
      targetUrl,
      pageCount: ingestedPages.length,
      ingestedAt: new Date().toISOString(),
    });

    const durationMs = Date.now() - startTime;

    let totalBytes = 0;
    let totalEstimatedTokens = 0;
    let totalCodeExamples = 0;

    for (const p of ingestedPages) {
      totalBytes += p.rawBytes;
      totalEstimatedTokens += p.estimatedTokens;
      totalCodeExamples += p.codeExamples.length;
      if (p.securityAnnotations.length > 0) {
        warnings.push(`Page "${p.url}" generated ${p.securityAnnotations.length} security alert(s).`);
      }
    }

    return {
      targetUrl,
      target: {
        type: 'url',
        value: targetUrl,
        normalizedUrl: targetUrl,
      },
      primarySourceId,
      sourcesDiscovered: discovered,
      selectedSources,
      pages: ingestedPages,
      pagesDiscovered,
      pagesFetched: visited.size,
      pagesStored: ingestedPages.length,
      snapshotId,
      warnings,
      errors,
      durationMs,
      stats: {
        totalPages: ingestedPages.length,
        totalBytes,
        totalEstimatedTokens,
        totalCodeExamples,
        machineReadableSources: discovered.filter(s => s.status === 'valid' && s.machineReadable).length,
      },
    };
  }
}
