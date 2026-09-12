import type {
  DocumentationTreeNode,
  DiscoveredDocTreeResult,
  ExtractedDocLink,
  LinkPriority,
  FetchedDocPage,
} from '../../shared/src/index.ts';
import { SecureFetcher } from './fetcher.ts';
import { DocumentationLinkExtractor } from './extractor.ts';
import { DocumentationSiteDetector } from '../../discovery/src/detector.ts';

export interface CrawlTreeOptions {
  maxPages?: number;
  maxDepth?: number;
  maxBytes?: number;
  timeoutMs?: number;
  allowExternalDocDomains?: boolean;
  concurrency?: number;
}

const IRRELEVANT_PATTERNS = [
  /\/(?:login|signin|sign-in|signup|register|auth\/login)(?:\/|$|\?)/i,
  /\/(?:pricing|billing|plans|checkout|cart|subscribe)(?:\/|$|\?)/i,
  /\/(?:terms|privacy|security|cookies|legal|gdpr)(?:\/|$|\?)/i,
  /\/(?:careers|jobs|about-us|team|press|contact)(?:\/|$|\?)/i,
  /\/(?:blog|news|events)(?:\/|$|\?)/i,
  /\/(?:facebook|twitter|x\.com|linkedin|instagram|youtube)\.com/i,
];

const PRIORITY_SCORES: Record<LinkPriority, number> = {
  nav_sidebar: 10,
  breadcrumb: 9,
  category: 8,
  body: 6,
  prev_next: 5,
  related: 4,
  footer: 2,
  unknown: 1,
};

interface QueueItem extends ExtractedDocLink {
  depth: number;
}

export class DocumentationTreeCrawler {
  private fetcher: SecureFetcher;
  private extractor: DocumentationLinkExtractor;
  private detector: DocumentationSiteDetector;

  constructor(
    fetcher: SecureFetcher,
    extractor?: DocumentationLinkExtractor,
    detector?: DocumentationSiteDetector
  ) {
    this.fetcher = fetcher;
    this.extractor = extractor || new DocumentationLinkExtractor();
    this.detector = detector || new DocumentationSiteDetector();
  }

  /**
   * Recursively crawls the documentation link graph starting from the documentation root.
   */
  async crawlTree(docRootUrl: string, options: CrawlTreeOptions = {}): Promise<DiscoveredDocTreeResult> {
    const maxPages = options.maxPages ?? 50;
    const maxDepth = options.maxDepth ?? 4;
    const maxBytes = options.maxBytes ?? 25 * 1024 * 1024; // 25MB total
    const timeoutMs = options.timeoutMs ?? 30000;
    const startTime = Date.now();

    const rootParsed = new URL(docRootUrl);
    const rootOrigin = rootParsed.origin;
    // Base doc path without trailing slash
    const baseDocPath = rootParsed.pathname.replace(/\/$/, '');
    const seedKeywords = docRootUrl
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4 && !['https', 'http', 'docs', 'html', 'com', 'org', 'net', 'io'].includes(w));

    const visited = new Set<string>();
    const queuedUrls = new Set<string>();
    const duplicateUrls: string[] = [];
    const failedUrls: Array<{ url: string; error: string }> = [];
    const pagesSkipped: Array<{ url: string; reason: string }> = [];

    // Priority Queue: sorted descending by priority score
    const queue: QueueItem[] = [];

    const enqueue = (item: QueueItem) => {
      const url = item.url;
      if (visited.has(url)) {
        duplicateUrls.push(url);
        return;
      }
      if (queuedUrls.has(url)) {
        duplicateUrls.push(url);
        return;
      }

      // Check URL relevance & scoping
      let parsedItemUrl: URL;
      try {
        parsedItemUrl = new URL(url);
      } catch {
        pagesSkipped.push({ url, reason: 'invalid_url' });
        return;
      }

      // 1. Same-origin constraint
      if (parsedItemUrl.origin !== rootOrigin) {
        pagesSkipped.push({ url, reason: 'cross_origin' });
        return;
      }

      // 2. Irrelevant marketing/auth/billing filter (never skip the root page requested by user)
      if (item.depth > 0) {
        const isDocHost = /^(?:docs?|apis?|developers?|dev|reference|help|learn|manual|book|wiki)\./i.test(parsedItemUrl.hostname);
        const isDocPath = /\/(?:docs?|apis?|documentation|guides?|reference|manual|sdk|tutorials?|specs?)(?:\/|$)/i.test(parsedItemUrl.pathname);
        const isDocSite = isDocHost || isDocPath;

        if (isDocSite) {
          // On documentation subdomains/paths, terms like checkout, billing, pricing, plans, subscribe
          // are API documentation sections. Only filter auth and shopping cart pages.
          const DOC_IRRELEVANT_PATTERNS = [
            /\/(?:login|signin|sign-in|signup|register|auth\/login)(?:\/|$|\?)/i,
            /\/(?:cart|order-summary|receipt)(?:\/|$|\?)/i,
            /\/(?:terms|privacy|security|cookies|legal|gdpr)(?:\/|$|\?)/i,
            /\/(?:careers|jobs|about-us|team|press|contact)(?:\/|$|\?)/i,
            /\/(?:facebook|twitter|x\.com|linkedin|instagram|youtube)\.com/i,
          ];
          if (DOC_IRRELEVANT_PATTERNS.some(p => p.test(parsedItemUrl.pathname))) {
            pagesSkipped.push({ url, reason: 'irrelevant_page' });
            return;
          }
        } else if (IRRELEVANT_PATTERNS.some(p => p.test(parsedItemUrl.pathname))) {
          pagesSkipped.push({ url, reason: 'irrelevant_page' });
          return;
        }
      }

      // 3. Documentation subpath scope check:
      // If root is /api/docs, pages should either start with /api/docs or stay within doc tree
      if (baseDocPath && baseDocPath !== '/' && baseDocPath !== '') {
        const path = parsedItemUrl.pathname.toLowerCase();
        const base = baseDocPath.toLowerCase();
        const isDocHost = /^(?:docs?|apis?|developers?|dev|reference|help|learn|manual|book|wiki)\./i.test(parsedItemUrl.hostname);
        const isWithinDocRoot = isDocHost || path.startsWith(base) || path.startsWith(`${base}/`);
        const isDocSister = /\/(?:api|docs?|guides?|reference|manual|sdk|tutorials?|specs?)(?:\/|$)/i.test(path);
        if (!isWithinDocRoot && !isDocSister) {
          pagesSkipped.push({ url, reason: 'out_of_doc_scope' });
          return;
        }
      }

      // 4. Max depth check
      if (item.depth > maxDepth) {
        pagesSkipped.push({ url, reason: 'max_depth_exceeded' });
        return;
      }

      queuedUrls.add(url);
      queue.push(item);
      // Keep queue sorted by priority score descending, with relevance boost for seed keywords
      queue.sort((a, b) => {
        let scoreA = PRIORITY_SCORES[a.priority] || 0;
        let scoreB = PRIORITY_SCORES[b.priority] || 0;
        if (seedKeywords.some(k => a.url.toLowerCase().includes(k))) scoreA += 5;
        if (seedKeywords.some(k => b.url.toLowerCase().includes(k))) scoreB += 5;
        return scoreB - scoreA;
      });
    };

    // Initial root enqueue
    enqueue({
      url: docRootUrl,
      text: 'Documentation Root',
      priority: 'nav_sidebar',
      depth: 0,
      discoveryMethod: 'root',
    });

    let totalBytesFetched = 0;
    let bounded = false;
    let boundedReason: string | undefined;

    const nodeMap = new Map<string, DocumentationTreeNode>();
    const parentMap = new Map<string, string>(); // childUrl -> parentUrl
    const fetchedPages: FetchedDocPage[] = [];
    let rootNode: DocumentationTreeNode | null = null;
    let rootDetection = this.detector.detect(docRootUrl, '');

    const concurrency = Math.max(1, options.concurrency ?? 4);
    let inFlight = 0;

    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      const schedule = () => {
        if (resolved) return;

        if (bounded) {
          if (inFlight === 0) finish();
          return;
        }

        if (queue.length === 0 && inFlight === 0) {
          finish();
          return;
        }

        while (inFlight < concurrency && queue.length > 0 && !bounded) {
          if (visited.size >= maxPages) {
            bounded = true;
            boundedReason = `Discovery bounded: ${maxPages} pages reached`;
            if (inFlight === 0) finish();
            return;
          }
          if (totalBytesFetched >= maxBytes) {
            bounded = true;
            boundedReason = `Discovery bounded: total byte limit reached (${Math.round(totalBytesFetched / 1024)} KB)`;
            if (inFlight === 0) finish();
            return;
          }
          if (Date.now() - startTime > timeoutMs) {
            bounded = true;
            boundedReason = `Discovery bounded: timeout reached (${timeoutMs}ms)`;
            if (inFlight === 0) finish();
            return;
          }

          const current = queue.shift()!;
          if (visited.has(current.url)) continue;
          visited.add(current.url);

          inFlight++;

          (async () => {
            try {
              const res = await this.fetcher.fetch(current.url, { timeoutMs: 5000 });
              if (res.status < 200 || res.status >= 300) {
                failedUrls.push({ url: current.url, error: `HTTP ${res.status}: ${res.statusText}` });
                return;
              }

              totalBytesFetched += res.bytesRead;

              let pageBody = res.body;
              let pageContentType = res.contentType;
              let finalUrl = res.finalUrl || current.url;

              // If HTML body lacks code blocks or has client-side placeholders, probe for .md or .mdx equivalent
              if (!current.url.endsWith('.md') && !current.url.endsWith('.mdx') && !current.url.endsWith('.json') && res.contentType.includes('text/html')) {
                if (!pageBody.includes('<pre') && !pageBody.includes('<code')) {
                  for (const ext of ['.md', '.mdx']) {
                    try {
                      const mdUrl = current.url.replace(/\/$/, '') + ext;
                      const mdRes = await this.fetcher.fetch(mdUrl, { timeoutMs: 3000 });
                      if (mdRes.status >= 200 && mdRes.status < 300 && mdRes.body.length > 200) {
                        pageBody = mdRes.body;
                        pageContentType = 'text/markdown';
                        finalUrl = mdRes.finalUrl || mdUrl;
                        break;
                      }
                    } catch {}
                  }
                }
              }

              fetchedPages.push({
                url: current.url,
                finalUrl,
                body: pageBody,
                contentType: pageContentType,
                bytesRead: Buffer.byteLength(pageBody),
                status: res.status,
                depth: current.depth,
                parentUrl: current.parentUrl,
                category: current.category,
                breadcrumb: current.breadcrumb,
                discoveryMethod: current.discoveryMethod,
                isCollapsed: current.isCollapsed,
              });

              const siteDetection = this.detector.detect(current.url, res.body, res.status, res.headers);
              if (current.depth === 0) {
                rootDetection = siteDetection;
              }

              // Extract title from HTML
              const titleMatch = res.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
              const pageTitle = titleMatch
                ? titleMatch[1].replace(/<[^>]+>/g, '').trim().split(/\s+[|–—-]\s+/)[0].trim()
                : current.text;

              const treeNode: DocumentationTreeNode = {
                url: current.url,
                title: pageTitle || current.text || 'Untitled',
                parentUrl: current.parentUrl,
                category: current.category,
                breadcrumb: current.breadcrumb || [],
                depth: current.depth,
                priority: current.priority,
                discoveryMethod: current.discoveryMethod,
                framework: siteDetection.framework,
                docVersion: siteDetection.docVersion,
                children: [],
              };

              nodeMap.set(current.url, treeNode);
              if (current.parentUrl) {
                parentMap.set(current.url, current.parentUrl);
              }

              if (!rootNode && current.url === docRootUrl) {
                rootNode = treeNode;
              }

              // Extract child links using DocumentationLinkExtractor
              const extraction = this.extractor.extract(res.body, current.url);

              for (const link of extraction.links) {
                enqueue({
                  ...link,
                  depth: current.depth + 1,
                  parentUrl: current.url,
                });
              }
            } catch (err: unknown) {
              failedUrls.push({
                url: current.url,
                error: err instanceof Error ? err.message : String(err),
              });
            } finally {
              inFlight--;
              schedule();
            }
          })();
        }
      };

      schedule();
    });

    // Build the hierarchical tree from nodeMap & parentMap
    if (!rootNode) {
      rootNode = {
        url: docRootUrl,
        title: 'Documentation Root',
        breadcrumb: [],
        depth: 0,
        priority: 'nav_sidebar',
        discoveryMethod: 'root',
        children: [],
      };
      nodeMap.set(docRootUrl, rootNode);
    }

    for (const [url, node] of nodeMap.entries()) {
      if (url === rootNode.url) continue;
      const parentUrl = parentMap.get(url);
      if (parentUrl && nodeMap.has(parentUrl)) {
        const parentNode = nodeMap.get(parentUrl)!;
        if (!parentNode.children.some(c => c.url === node.url)) {
          parentNode.children.push(node);
        }
      } else {
        // Attach directly to root if parent was not crawled
        if (!rootNode.children.some(c => c.url === node.url)) {
          rootNode.children.push(node);
        }
      }
    }

    return {
      rootUrl: docRootUrl,
      candidateUrl: docRootUrl,
      siteDetection: rootDetection,
      tree: rootNode,
      pagesDiscovered: visited.size + queue.length + pagesSkipped.length,
      pagesIndexed: visited.size - failedUrls.length,
      pagesSkipped,
      failedUrls,
      duplicateUrls,
      fetchedPages,
      crawlLimits: {
        maxPages,
        maxDepth,
        maxBytes,
        timeoutMs,
      },
      bounded,
      boundedReason,
    };
  }
}
