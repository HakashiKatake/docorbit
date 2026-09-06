import type { DiscoveredSource } from '../../../shared/src/index.ts';
import { SecureFetcher } from '../../../crawler/src/index.ts';
import type { DiscoveryProvider } from '../provider.ts';

export class MarkdownProvider implements DiscoveryProvider {
  name = 'markdown';

  async discover(targetUrl: string, fetcher: SecureFetcher): Promise<DiscoveredSource[]> {
    const results: DiscoveredSource[] = [];

    const mdProbeUrl = targetUrl.endsWith('.md')
      ? targetUrl
      : targetUrl.replace(/\/$/, '') + '.md';

    try {
      const res = await fetcher.fetch(mdProbeUrl, {
        timeoutMs: 4000,
      });

      if (res.status >= 200 && res.status < 300) {
        const isMarkdown =
          res.contentType.includes('text/markdown') ||
          res.contentType.includes('text/plain') ||
          res.body.startsWith('#');

        if (isMarkdown && !res.body.includes('<html')) {
          results.push({
            url: mdProbeUrl,
            type: 'markdown',
            discoveredBy: this.name,
            status: 'valid',
            contentType: res.contentType,
            confidence: 0.95,
            authority: 'official',
            machineReadable: true,
            metadata: {
              bytes: res.bytesRead,
            },
          });
        }
      }
    } catch {
      // Continue
    }

    return results;
  }
}
