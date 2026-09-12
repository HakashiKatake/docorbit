import type { DiscoveredSource } from '../../../shared/src/index.ts';
import { SecureFetcher } from '../../../crawler/src/index.ts';
import type { DiscoveryProvider } from '../provider.ts';

export class SitemapProvider implements DiscoveryProvider {
  name = 'sitemap';

  async discover(targetUrl: string, fetcher: SecureFetcher): Promise<DiscoveredSource[]> {
    const results: DiscoveredSource[] = [];
    let baseUrl: URL;
    try {
      baseUrl = new URL(targetUrl);
    } catch {
      return results;
    }

    const cleanPath = baseUrl.pathname.replace(/\/$/, '');

    const candidatePaths = ['/sitemap.xml', '/sitemap_index.xml'];
    if (cleanPath && cleanPath !== '') {
      candidatePaths.unshift(`${cleanPath}/sitemap.xml`);
    }

    // Check robots.txt for Sitemap directives
    try {
      const robotsUrl = new URL('/robots.txt', baseUrl.origin).href;
      const robotsRes = await fetcher.fetch(robotsUrl, { timeoutMs: 3000 });
      if (robotsRes.status >= 200 && robotsRes.status < 300 && robotsRes.body) {
        const sitemapMatches = robotsRes.body.matchAll(/^[ \t]*Sitemap:[ \t]*([^\r\n#]+)/gim);
        for (const m of sitemapMatches) {
          const sitemapUrl = m[1].trim();
          try {
            const parsed = new URL(sitemapUrl, baseUrl.origin);
            candidatePaths.unshift(parsed.pathname + parsed.search);
          } catch {}
        }
      }
    } catch {}

    const seenUrls = new Set<string>();

    for (const path of candidatePaths) {
      const probeUrl = new URL(path, baseUrl.origin).href;
      if (seenUrls.has(probeUrl)) continue;
      seenUrls.add(probeUrl);

      try {
        const res = await fetcher.fetch(probeUrl, {
          timeoutMs: 4000,
        });

        if (res.status >= 200 && res.status < 300) {
          const isXml = res.contentType.includes('xml') || res.body.includes('<urlset') || res.body.includes('<sitemapindex');
          if (isXml) {
            results.push({
              url: probeUrl,
              type: 'sitemap',
              discoveredBy: this.name,
              status: 'valid',
              contentType: res.contentType,
              confidence: 0.9,
              authority: 'official',
              machineReadable: true,
              metadata: {
                bytes: res.bytesRead,
              },
            });
            break;
          }
        }
      } catch {
        // Continue
      }
    }

    return results;
  }
}
