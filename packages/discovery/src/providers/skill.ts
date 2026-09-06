import type { DiscoveredSource } from '../../../shared/src/index.ts';
import { SecureFetcher } from '../../../crawler/src/index.ts';
import type { DiscoveryProvider } from '../provider.ts';

export class SkillProvider implements DiscoveryProvider {
  name = 'skill';

  async discover(targetUrl: string, fetcher: SecureFetcher): Promise<DiscoveredSource[]> {
    const results: DiscoveredSource[] = [];
    let baseUrl: URL;
    try {
      baseUrl = new URL(targetUrl);
    } catch {
      return results;
    }

    const candidatePaths = ['/skill.md', '/.well-known/skills/skill.md'];

    for (const path of candidatePaths) {
      const probeUrl = new URL(path, baseUrl.origin).href;
      try {
        const res = await fetcher.fetch(probeUrl, {
          timeoutMs: 4000,
        });

        if (res.status >= 200 && res.status < 300) {
          const hasYamlHeader = /^---\s*\n([\s\S]*?)\n---/m.test(res.body);
          const hasName = /\bname:\s*.+/i.test(res.body);

          if (hasYamlHeader && hasName) {
            results.push({
              url: probeUrl,
              type: 'skill',
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
