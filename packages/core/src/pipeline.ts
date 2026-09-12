import type {
  DiscoveredSource,
  NormalizedPage,
  CrawlerConfig,
  CrawlPolicy,
  Target,
  SourcePurpose,
  DocumentationTreeNode,
  DocumentationSiteDetection,
} from '../../shared/src/index.ts';
import { validateTargetUrl } from '../../security/src/index.ts';
import {
  SecureFetcher,
  DEFAULT_CRAWLER_CONFIG,
  DocumentationTreeCrawler,
} from '../../crawler/src/index.ts';
import {
  createDefaultDiscoveryCoordinator,
  rankSources,
  DocumentationRootFinder,
  DocumentationSiteDetector,
} from '../../discovery/src/index.ts';
import {
  buildNormalizedPage,
  parseLlmsTxt,
  isValidLlmsTxt,
  slicePageIntoChunks,
  parseOpenApiEndpoints,
  detectOpenApiSpec,
  extractIndexedExamples,
  extractPitfalls,
} from '../../normalizer/src/index.ts';
import { DocOrbitRepository } from '../../storage/src/index.ts';

export interface IngestionOptions {
  crawlerConfig?: Partial<CrawlerConfig>;
  crawlPolicy?: Partial<CrawlPolicy>;
  allowLocalhostForTesting?: boolean;
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
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
    totalChunks: number;
  };
  docTree?: DocumentationTreeNode;
  siteDetection?: DocumentationSiteDetection;
  discoveredDocRoot?: string;
  bounded?: boolean;
  boundedReason?: string;
  pagesSkipped?: Array<{ url: string; reason: string }>;
  duplicateUrls?: string[];
}


export class IngestionPipeline {
  private repository: DocOrbitRepository;
  private fetcher: SecureFetcher;
  private config: CrawlerConfig;
  private policy: CrawlPolicy;
  private allowLocalhostForTesting: boolean;
  private dnsLookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;

  constructor(repository: DocOrbitRepository, options: IngestionOptions = {}) {
    this.repository = repository;
    this.config = {
      ...DEFAULT_CRAWLER_CONFIG,
      ...options.crawlerConfig,
    };
    this.allowLocalhostForTesting = options.allowLocalhostForTesting ?? false;
    this.dnsLookup = options.dnsLookup;
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
      dnsLookup: this.dnsLookup,
    });
  }

  async ingest(targetUrl: string): Promise<IngestionResult> {
    const startTime = Date.now();

    // 1. SSRF & Protocol validation before making any discovery probes
    const activeDnsLookup = this.dnsLookup ?? (this.fetcher as any)?.dnsLookup;
    await validateTargetUrl(targetUrl, {
      allowLocalhostForTesting: this.allowLocalhostForTesting,
      dnsLookup: activeDnsLookup,
    });

    // 2. Discover canonical documentation root and machine-readable sources
    const rootFinder = new DocumentationRootFinder();
    const rootResult = await rootFinder.findDocumentationRoot(targetUrl, this.fetcher);

    const coordinator = createDefaultDiscoveryCoordinator();
    const discovered = await coordinator.discoverAll(targetUrl, this.fetcher);

    if (rootResult.detection.isDocumentation && rootResult.rootUrl !== targetUrl) {
      const alreadyHas = discovered.some(s => s.url.replace(/\/$/, '') === rootResult.rootUrl.replace(/\/$/, ''));
      if (!alreadyHas) {
        discovered.unshift({
          url: rootResult.rootUrl,
          type: 'web',
          discoveredBy: rootResult.discoveredBy,
          status: 'valid',
          confidence: rootResult.detection.confidence,
          authority: 'official',
          machineReadable: false,
          metadata: {
            framework: rootResult.detection.framework,
            documentationType: rootResult.detection.documentationType,
            docVersion: rootResult.detection.docVersion,
            explanation: rootResult.detection.explanation,
          },
        });
      }
    }

    const sourceIds: Record<string, string> = {};
    for (const s of discovered) {
      const id = this.repository.saveSource(s);
      sourceIds[s.url] = id;
    }

    const conceptualRank = rankSources(discovered, 'conceptual');
    const apiRank = rankSources(discovered, 'api');

    const effectiveDocRootUrl = (rootResult.detection.isDocumentation && rootResult.rootUrl)
      ? rootResult.rootUrl
      : targetUrl;

    let primarySource = discovered.find(s => s.url.replace(/\/$/, '') === effectiveDocRootUrl.replace(/\/$/, ''));
    let primarySourceId = primarySource ? (sourceIds[primarySource.url] || this.repository.saveSource(primarySource)) : undefined;

    if (!primarySourceId) {
      primarySourceId = this.repository.saveSource({
        url: effectiveDocRootUrl,
        type: 'web',
        discoveredBy: rootResult.discoveredBy || 'direct',
        status: 'valid',
        confidence: rootResult.detection.confidence || 1.0,
        authority: 'official',
        machineReadable: false,
        metadata: {
          framework: rootResult.detection.framework,
          documentationType: rootResult.detection.documentationType,
          docVersion: rootResult.detection.docVersion,
        },
      });
      sourceIds[effectiveDocRootUrl] = primarySourceId;
    }

    const purposes: SourcePurpose[] = ['navigation', 'conceptual', 'api', 'examples', 'implementation'];
    const selectedSources = purposes.map(p => {
      const ranked = rankSources(discovered, p);
      return {
        purpose: p,
        sourceId: ranked.recommended ? (sourceIds[ranked.recommended.url] || primarySourceId) : primarySourceId,
      };
    });

    // 3. Recursive Documentation Tree Crawling
    const treeCrawler = new DocumentationTreeCrawler(this.fetcher);
    const treeResult = await treeCrawler.crawlTree(effectiveDocRootUrl, {
      maxPages: this.policy.maxPages,
      maxDepth: this.policy.maxDepth,
      allowExternalDocDomains: this.policy.followExternalDomains,
    });

    const ingestedPages: NormalizedPage[] = [];
    const warnings: string[] = [];
    const errors: Array<{ url: string; error: string }> = [...treeResult.failedUrls];

    if (treeResult.bounded && treeResult.boundedReason) {
      warnings.push(treeResult.boundedReason);
    }

    // Ingest all pages discovered and fetched by the tree crawler
    const fetchedPages = treeResult.fetchedPages || [];
    const seenUrls = new Set<string>();

    for (const fp of fetchedPages) {
      if (seenUrls.has(fp.url)) continue;
      seenUrls.add(fp.url);

      const page = buildNormalizedPage({
        sourceId: primarySourceId,
        url: fp.finalUrl || fp.url,
        rawContent: fp.body,
        contentType: fp.contentType,
        sourceUrl: primarySource?.url || effectiveDocRootUrl,
        targetUrl,
        discoveredBy: fp.discoveryMethod || primarySource?.discoveredBy || 'tree_crawler',
        fetchedAt: new Date().toISOString(),
        parentUrl: fp.parentUrl,
        category: fp.category,
        breadcrumb: fp.breadcrumb,
        depth: fp.depth,
        framework: treeResult.siteDetection.framework,
        docVersion: treeResult.siteDetection.docVersion,
      });

      this.repository.savePage(page);
      ingestedPages.push(page);
    }

    // 4. Ingest auxiliary machine-readable sources (OpenAPI or llms.txt)
    const auxiliaryUrlsToFetch: Array<{ url: string; discoveredBy: string }> = [];

    if (apiRank.recommended && apiRank.recommended.type === 'openapi' && !seenUrls.has(apiRank.recommended.url)) {
      auxiliaryUrlsToFetch.push({ url: apiRank.recommended.url, discoveredBy: 'openapi' });
    }

    const bestLlms = discovered.find(s => s.type === 'llms_full_txt' && s.status === 'valid')
      || discovered.find(s => s.type === 'llms_txt' && s.status === 'valid');
    if (bestLlms && !seenUrls.has(bestLlms.url)) {
      auxiliaryUrlsToFetch.push({ url: bestLlms.url, discoveredBy: bestLlms.discoveredBy });
    }

    for (const aux of auxiliaryUrlsToFetch) {
      if (seenUrls.has(aux.url)) continue;
      if (ingestedPages.length >= this.policy.maxPages) break;
      seenUrls.add(aux.url);

      try {
        const res = await this.fetcher.fetch(aux.url, { timeoutMs: 12000 });
        if (res.status >= 200 && res.status < 300) {
          const page = buildNormalizedPage({
            sourceId: primarySourceId,
            url: res.finalUrl || aux.url,
            rawContent: res.body,
            contentType: res.contentType,
            sourceUrl: aux.url,
            targetUrl,
            discoveredBy: aux.discoveredBy,
            fetchedAt: new Date().toISOString(),
            depth: 0,
          });
          this.repository.savePage(page);
          ingestedPages.push(page);

          // If llms.txt has links and policy permits subpage traversal
          if (isValidLlmsTxt(res.body) && this.policy.followLlmsReferences && this.policy.maxDepth > 0) {
            const llmsDoc = parseLlmsTxt(res.body, aux.url);
            const targetKeywords = targetUrl
              .toLowerCase()
              .split(/[^a-z0-9]+/)
              .filter(w => w.length >= 4 && !['https', 'http', 'docs', 'html', 'com', 'org', 'net', 'io'].includes(w));

            // Flatten links and prioritize those matching target keywords
            const allLlmsLinks: Array<{ url: string; title: string }> = [];
            for (const sec of llmsDoc.sections) {
              for (const lnk of sec.links) {
                allLlmsLinks.push(lnk);
              }
            }

            allLlmsLinks.sort((a, b) => {
              const aMatches = targetKeywords.filter(k => a.url.toLowerCase().includes(k) || a.title.toLowerCase().includes(k)).length;
              const bMatches = targetKeywords.filter(k => b.url.toLowerCase().includes(k) || b.title.toLowerCase().includes(k)).length;
              return bMatches - aMatches;
            });

            for (const lnk of allLlmsLinks) {
              if (ingestedPages.length >= this.policy.maxPages) break;
              if (seenUrls.has(lnk.url)) continue;
              try {
                const lUrl = new URL(lnk.url, aux.url).href;
                if (!seenUrls.has(lUrl)) {
                  seenUrls.add(lUrl);
                  const subRes = await this.fetcher.fetch(lUrl, { timeoutMs: 5000 });
                  if (subRes.status >= 200 && subRes.status < 300) {
                    const subPage = buildNormalizedPage({
                      sourceId: primarySourceId,
                      url: subRes.finalUrl || lUrl,
                      rawContent: subRes.body,
                      contentType: subRes.contentType,
                      sourceUrl: aux.url,
                      targetUrl,
                      discoveredBy: 'llms_link',
                      fetchedAt: new Date().toISOString(),
                      depth: 1,
                    });
                    this.repository.savePage(subPage);
                    ingestedPages.push(subPage);
                  }
                }
              } catch {}
            }
          }
        }
      } catch (err) {
        errors.push({ url: aux.url, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const snapshotId = this.repository.createSnapshot(primarySourceId, {
      targetUrl,
      pageCount: ingestedPages.length,
      ingestedAt: new Date().toISOString(),
    });

    // Milestone 2: Semantic slicing of pages into standalone DocumentChunks
    let totalChunks = 0;
    for (const p of ingestedPages) {
      const slicingResult = slicePageIntoChunks(p, snapshotId);
      this.repository.saveChunks(
        slicingResult.chunks,
        slicingResult.relationships,
        slicingResult.codeSnippets,
        slicingResult.symbols
      );
      totalChunks += slicingResult.chunks.length;

      // Milestone 4: API Endpoints
      if (p.openApiSummary || detectOpenApiSpec(p.content, p.url)) {
        const endpoints = parseOpenApiEndpoints(p.content, p.id, snapshotId, p.url, p.docVersion);
        if (endpoints.length > 0) {
          this.repository.saveApiEndpoints(endpoints);
        }
      }

      // Milestone 4: Indexed Examples
      const examples = extractIndexedExamples(p, slicingResult.chunks, primarySource?.authority || 'official', p.docVersion, snapshotId);
      if (examples.length > 0) {
        this.repository.saveIndexedExamples(examples);
      }

      // Milestone 4: Pitfalls
      const pitfalls = extractPitfalls(p, slicingResult.chunks, p.docVersion, snapshotId);
      if (pitfalls.length > 0) {
        this.repository.savePitfalls(pitfalls);
      }
    }

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
      pagesDiscovered: treeResult.pagesDiscovered,
      pagesFetched: fetchedPages.length,
      pagesStored: ingestedPages.length,
      snapshotId,
      warnings,
      errors,
      durationMs,
      docTree: treeResult.tree,
      siteDetection: treeResult.siteDetection,
      discoveredDocRoot: effectiveDocRootUrl,
      bounded: treeResult.bounded,
      boundedReason: treeResult.boundedReason,
      pagesSkipped: treeResult.pagesSkipped,
      duplicateUrls: treeResult.duplicateUrls,
      stats: {
        totalPages: ingestedPages.length,
        totalBytes,
        totalEstimatedTokens,
        totalCodeExamples,
        machineReadableSources: discovered.filter(s => s.status === 'valid' && s.machineReadable).length,
        totalChunks,
      },
    };
  }
}

