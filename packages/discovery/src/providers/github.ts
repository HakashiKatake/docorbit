import type { DiscoveredSource } from '../../../shared/src/index.ts';
import { SecureFetcher } from '../../../crawler/src/index.ts';
import type { DiscoveryProvider } from '../provider.ts';

export class GithubProvider implements DiscoveryProvider {
  name = 'github';

  async discover(targetUrl: string, fetcher: SecureFetcher): Promise<DiscoveredSource[]> {
    const results: DiscoveredSource[] = [];

    const isDirectGithub = /^https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(targetUrl);
    if (isDirectGithub) {
      results.push({
        url: targetUrl,
        type: 'github',
        discoveredBy: this.name,
        status: 'valid',
        confidence: 0.99,
        authority: 'official',
        machineReadable: false,
      });
      return results;
    }

    try {
      const res = await fetcher.fetch(targetUrl, {
        timeoutMs: 4000,
      });

      if (res.status >= 200 && res.status < 300 && res.body) {
        const githubMatches = res.body.matchAll(/href=["'](https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/)?)(?:["']|[/?#])/gi);
        const seenRepos = new Set<string>();

        for (const m of githubMatches) {
          const repoUrl = m[1].replace(/\/$/, '');
          if (repoUrl.includes('/topics') || repoUrl.includes('/features') || repoUrl.includes('/pricing')) continue;

          if (!seenRepos.has(repoUrl)) {
            seenRepos.add(repoUrl);
            results.push({
              url: repoUrl,
              type: 'github',
              discoveredBy: this.name,
              status: 'valid',
              confidence: 0.85,
              authority: 'official',
              machineReadable: false,
              metadata: {
                foundOn: targetUrl,
              },
            });
          }
        }
      }
    } catch {
      // Continue
    }

    return results;
  }
}
