import type { DocumentationSiteDetection } from '../../shared/src/index.ts';
import { SecureFetcher } from '../../crawler/src/index.ts';
import { DocumentationSiteDetector } from './detector.ts';

export interface DocumentationRootResult {
  rootUrl: string;
  detection: DocumentationSiteDetection;
  candidates: Array<{ url: string; detection: DocumentationSiteDetection }>;
  isDirectMatch: boolean;
  discoveredBy: string;
}

const KNOWN_DOC_PATHS = [
  '/api/docs/',
  '/api/docs',
  '/docs/',
  '/docs',
  '/documentation/',
  '/documentation',
  '/api-docs/',
  '/api-docs',
  '/api/reference/',
  '/api/v1/docs/',
  '/api/v2/docs/',
  '/developers/',
  '/developer/',
  '/guides/',
  '/api/',
];

export class DocumentationRootFinder {
  private detector: DocumentationSiteDetector;

  constructor(detector?: DocumentationSiteDetector) {
    this.detector = detector || new DocumentationSiteDetector();
  }

  /**
   * Discovers the authoritative documentation root from any URL or homepage.
   */
  async findDocumentationRoot(
    targetUrl: string,
    fetcher: SecureFetcher,
    options: { maxProbes?: number } = {}
  ): Promise<DocumentationRootResult> {
    const maxProbes = options.maxProbes ?? 12;
    let baseUrl: URL;
    try {
      baseUrl = new URL(targetUrl);
    } catch {
      throw new Error(`Invalid URL for root discovery: ${targetUrl}`);
    }

    const candidateUrls = new Set<string>();
    candidateUrls.add(targetUrl);

    // 1. Fetch initial target page
    let targetHtml = '';
    let targetStatus = 0;
    try {
      const res = await fetcher.fetch(targetUrl, { timeoutMs: 5000 });
      targetStatus = res.status;
      targetHtml = res.body;
      if (res.finalUrl && res.finalUrl !== targetUrl) {
        candidateUrls.add(res.finalUrl);
      }
    } catch {
      // Continue with path probing
    }

    // Evaluate target page directly
    const targetDetection = this.detector.detect(targetUrl, targetHtml, targetStatus);
    const scoredCandidates: Array<{ url: string; detection: DocumentationSiteDetection }> = [];
    scoredCandidates.push({ url: targetUrl, detection: targetDetection });

    // If targetUrl itself is high confidence documentation root, prioritize it
    if (targetDetection.isDocumentation && targetDetection.confidence >= 0.85 && targetDetection.signals.hasNavOrSidebar) {
      return {
        rootUrl: targetUrl,
        detection: targetDetection,
        candidates: scoredCandidates,
        isDirectMatch: true,
        discoveredBy: 'direct_match',
      };
    }

    // 2. Discover candidate links from HTML
    if (targetHtml) {
      const linkRegex = /<a\b[^>]*\bhref=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(targetHtml)) !== null) {
        const href = match[1].trim();
        const text = match[2].replace(/<[^>]+>/g, '').trim().toLowerCase();
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;

        const isDocText = /(?:documentation|api reference|api docs?|developer|guides?|manual|api)/i.test(text);
        const isDocHref = /\/(?:docs?|documentation|api[\/_-]docs?|api[\/_-]reference|developers?|guides?|manual|api)(?:\/|$)/i.test(href);

        if (isDocText || isDocHref) {
          try {
            const resolved = new URL(href, targetUrl).href;
            const resolvedUrl = new URL(resolved);
            // Must match origin or be a subdomain
            if (resolvedUrl.hostname === baseUrl.hostname || resolvedUrl.hostname.endsWith(`.${baseUrl.hostname}`)) {
              candidateUrls.add(resolved);
            }
          } catch {}
        }
      }
    }

    // 3. Add known documentation probe paths on target origin
    for (const path of KNOWN_DOC_PATHS) {
      const probe = new URL(path, baseUrl.origin).href;
      candidateUrls.add(probe);
    }

    // Probe candidate URLs up to maxProbes limit
    const tested = new Set<string>();
    tested.add(targetUrl);

    for (const candUrl of candidateUrls) {
      if (tested.has(candUrl)) continue;
      if (tested.size >= maxProbes) break;
      tested.add(candUrl);

      try {
        const probeRes = await fetcher.fetch(candUrl, { timeoutMs: 4000 });
        if (probeRes.status >= 200 && probeRes.status < 300) {
          const finalProbeUrl = probeRes.finalUrl || candUrl;
          const detection = this.detector.detect(finalProbeUrl, probeRes.body, probeRes.status, probeRes.headers);
          scoredCandidates.push({ url: finalProbeUrl, detection });
        }
      } catch {
        // Probe failed, continue
      }
    }

    // Sort candidates by detection confidence descending
    scoredCandidates.sort((a, b) => {
      if (b.detection.confidence !== a.detection.confidence) {
        return b.detection.confidence - a.detection.confidence;
      }
      // Prefer standard doc path shapes
      const aIsStandard = /\/(?:api\/)?docs\/?$/i.test(a.url) ? 1 : 0;
      const bIsStandard = /\/(?:api\/)?docs\/?$/i.test(b.url) ? 1 : 0;
      return bIsStandard - aIsStandard;
    });

    const best = scoredCandidates[0];
    const isDoc = best && best.detection.isDocumentation;
    let rootUrl = isDoc ? best.url : targetUrl;
    try {
      const u = new URL(rootUrl);
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
        rootUrl = u.href;
      }
    } catch {}

    return {
      rootUrl,
      detection: isDoc ? best.detection : targetDetection,
      candidates: scoredCandidates,
      isDirectMatch: best ? best.url === targetUrl : true,
      discoveredBy: isDoc && best.url !== targetUrl ? 'ladder_probe' : 'direct',
    };
  }
}
