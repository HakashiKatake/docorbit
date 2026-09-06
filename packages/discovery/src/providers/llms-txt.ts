import type { DiscoveredSource } from '../../../shared/src/index.ts';
import { SecureFetcher } from '../../../crawler/src/index.ts';
import { isValidLlmsTxt } from '../../../normalizer/src/index.ts';
import type { DiscoveryProvider } from '../provider.ts';

export class LlmsTxtProvider implements DiscoveryProvider {
  name = 'llms_txt';

  async discover(targetUrl: string, fetcher: SecureFetcher): Promise<DiscoveredSource[]> {
    const results: DiscoveredSource[] = [];
    let baseUrl: URL;
    try {
      baseUrl = new URL(targetUrl);
    } catch {
      return results;
    }

    const cleanPath = baseUrl.pathname.replace(/\/$/, '');

    // Probe both subpath-relative and origin-root paths
    const candidatePaths: Array<{ path: string; type: 'llms_txt' | 'llms_full_txt' }> = [
      { path: '/llms.txt', type: 'llms_txt' },
      { path: '/llms-full.txt', type: 'llms_full_txt' },
      { path: '/.well-known/llms.txt', type: 'llms_txt' },
    ];

    if (cleanPath && cleanPath !== '') {
      candidatePaths.unshift(
        { path: `${cleanPath}/llms.txt`, type: 'llms_txt' },
        { path: `${cleanPath}/llms-full.txt`, type: 'llms_full_txt' }
      );
    }

    const seenUrls = new Set<string>();

    for (const item of candidatePaths) {
      const probeUrl = new URL(item.path, baseUrl.origin).href;
      if (seenUrls.has(probeUrl)) continue;
      seenUrls.add(probeUrl);

      try {
        const res = await fetcher.fetch(probeUrl, {
          timeoutMs: 4000,
        });

        if (res.status >= 200 && res.status < 300) {
          const isValid = isValidLlmsTxt(res.body);
          const isNotHtml = !res.contentType.includes('text/html') && !res.body.includes('<html');
          if (isValid || (item.type === 'llms_full_txt' && isNotHtml)) {
            results.push({
              url: probeUrl,
              type: item.type,
              discoveredBy: this.name,
              status: 'valid',
              contentType: res.contentType,
              confidence: 0.98,
              authority: 'official',
              machineReadable: true,
              metadata: {
                bytes: res.bytesRead,
                path: item.path,
              },
            });
          }
        }
      } catch {
        // Continue
      }
    }

    return results;
  }
}
