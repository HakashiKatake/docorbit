import type { DiscoveredSource } from '../../../shared/src/index.ts';
import { SecureFetcher } from '../../../crawler/src/index.ts';
import type { DiscoveryProvider } from '../provider.ts';

export class GenericWebProvider implements DiscoveryProvider {
  name = 'generic_web';

  async discover(targetUrl: string, fetcher: SecureFetcher): Promise<DiscoveredSource[]> {
    const results: DiscoveredSource[] = [];

    try {
      const res = await fetcher.fetch(targetUrl, {
        timeoutMs: 5000,
      });

      if (res.status >= 200 && res.status < 300) {
        let framework = 'unknown';
        const bodyLower = res.body.toLowerCase();

        // Check generator meta tags or distinctive DOM anchors first
        const metaGenerator = res.body.match(/<meta\b[^>]*\bname=["']generator["'][^>]*\bcontent=["']([^"']+)["']/i);
        const generatorVal = metaGenerator ? metaGenerator[1].toLowerCase() : '';

        if (generatorVal.includes('docusaurus') || res.body.includes('__docusaurus') || res.body.includes('docusaurus-plugin')) {
          framework = 'docusaurus';
        } else if (generatorVal.includes('mintlify') || res.body.includes('_mintlify') || res.body.includes('mintlify.css') || res.body.includes('mintlify.com')) {
          framework = 'mintlify';
        } else if (generatorVal.includes('nextra') || res.body.includes('__nextra')) {
          framework = 'nextra';
        } else if (generatorVal.includes('gitbook') || res.body.includes('gitbook-root') || res.body.includes('data-gitbook')) {
          framework = 'gitbook';
        } else if (generatorVal.includes('mkdocs') || res.body.includes('mkdocs')) {
          framework = 'mkdocs';
        } else if (generatorVal.includes('sphinx') || res.body.includes('sphinxsidebar')) {
          framework = 'sphinx';
        }

        // Section 18: Detect candidate doc sections without blindly crawling
        const candidateSections: string[] = [];
        const sectionRegex = /href=["']([^"'#?]+(?:\/docs|\/api|\/reference|\/guides|\/tutorials|\/changelog)[^"'#?]*)["']/gi;
        let sMatch: RegExpExecArray | null;
        while ((sMatch = sectionRegex.exec(res.body)) !== null) {
          try {
            const secUrl = new URL(sMatch[1], targetUrl).href;
            if (new URL(secUrl).origin === new URL(targetUrl).origin && !candidateSections.includes(secUrl)) {
              candidateSections.push(secUrl);
              if (candidateSections.length >= 10) break;
            }
          } catch {
            // Ignore
          }
        }

        const linkHeader = res.headers['link'];
        if (linkHeader) {
          const llmsMatch = linkHeader.match(/<([^>]+)>;\s*rel=["']?(?:llms-txt|alternate)["']?/i);
          if (llmsMatch) {
            try {
              const fullLlmsUrl = new URL(llmsMatch[1], targetUrl).href;
              results.push({
                url: fullLlmsUrl,
                type: 'llms_txt',
                discoveredBy: `${this.name}:link-header`,
                status: 'valid',
                confidence: 0.99,
                authority: 'official',
                machineReadable: true,
              });
            } catch {
              // Ignore
            }
          }
        }

        results.push({
          url: res.finalUrl || targetUrl,
          type: 'web',
          discoveredBy: this.name,
          status: 'valid',
          contentType: res.contentType,
          confidence: 0.85,
          authority: 'official',
          machineReadable: false,
          metadata: {
            framework,
            status: res.status,
            bytes: res.bytesRead,
            candidateSections,
          },
        });
      }
    } catch {
      // Continue
    }

    return results;
  }
}
