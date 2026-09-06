import type { DiscoveredSource } from '../../shared/src/index.ts';
import { SecureFetcher } from '../../crawler/src/index.ts';

export interface DiscoveryProvider {
  name: string;
  discover(targetUrl: string, fetcher: SecureFetcher): Promise<DiscoveredSource[]>;
}

export class DiscoveryCoordinator {
  private providers: DiscoveryProvider[] = [];

  register(provider: DiscoveryProvider): this {
    this.providers.push(provider);
    return this;
  }

  getProviders(): DiscoveryProvider[] {
    return [...this.providers];
  }

  async discoverAll(targetUrl: string, fetcher: SecureFetcher): Promise<DiscoveredSource[]> {
    const results = await Promise.allSettled(
      this.providers.map(p => p.discover(targetUrl, fetcher))
    );

    const allSources: DiscoveredSource[] = [];
    for (const res of results) {
      if (res.status === 'fulfilled') {
        allSources.push(...res.value);
      }
    }

    // Deduplicate sources by normalized URL
    const seen = new Set<string>();
    const deduped: DiscoveredSource[] = [];

    for (const s of allSources) {
      const normalizedUrl = s.url.replace(/\/$/, '').toLowerCase();
      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        deduped.push(s);
      }
    }

    return deduped;
  }
}
