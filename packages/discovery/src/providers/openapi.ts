import type { DiscoveredSource } from '../../../shared/src/index.ts';
import { SecureFetcher } from '../../../crawler/src/index.ts';
import { detectOpenApiSpec } from '../../../normalizer/src/index.ts';
import type { DiscoveryProvider } from '../provider.ts';

export class OpenApiProvider implements DiscoveryProvider {
  name = 'openapi';

  async discover(targetUrl: string, fetcher: SecureFetcher): Promise<DiscoveredSource[]> {
    const results: DiscoveredSource[] = [];
    let baseUrl: URL;
    try {
      baseUrl = new URL(targetUrl);
    } catch {
      return results;
    }

    const cleanPath = baseUrl.pathname.replace(/\/$/, '');

    const candidatePaths = [
      '/openapi.json',
      '/openapi.yaml',
      '/swagger.json',
      '/v3/api-docs',
      '/api-docs',
    ];

    if (cleanPath && cleanPath !== '') {
      candidatePaths.unshift(
        `${cleanPath}/openapi.json`,
        `${cleanPath}/openapi.yaml`,
        `${cleanPath}/swagger.json`
      );
    }

    // Also probe targetUrl HTML for <link rel="service-doc">
    try {
      const pageRes = await fetcher.fetch(targetUrl, { timeoutMs: 4000 });
      if (pageRes.status >= 200 && pageRes.status < 300 && pageRes.body) {
        const linkMatch = pageRes.body.match(/<link\b[^>]*\brel=["'](?:service-doc|openapi|swagger)["'][^>]*\bhref=["']([^"']+)["']/i);
        if (linkMatch) {
          const docHref = new URL(linkMatch[1], targetUrl).href;
          candidatePaths.unshift(new URL(docHref).pathname);
        }
      }
    } catch {
      // Continue
    }

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
          const spec = detectOpenApiSpec(res.body, probeUrl);
          if (spec) {
            results.push({
              url: probeUrl,
              type: 'openapi',
              discoveredBy: this.name,
              status: 'valid',
              contentType: res.contentType,
              confidence: 0.99,
              authority: 'official',
              machineReadable: true,
              metadata: {
                specVersion: spec.specVersion,
                title: spec.title,
                pathCount: spec.pathCount,
                servers: spec.servers,
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
