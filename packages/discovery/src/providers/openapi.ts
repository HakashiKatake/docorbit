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

    const candidateUrls: string[] = [];

    // 1. Dynamic OpenAPI Spec extraction from HTML (Swagger UI, Redoc, Stoplight, Scalar, Mintlify)
    try {
      const pageRes = await fetcher.fetch(targetUrl, { timeoutMs: 4000 });
      if (pageRes.status >= 200 && pageRes.status < 300 && pageRes.body) {
        const body = pageRes.body;

        // <link rel="service-doc|openapi|swagger">
        const linkMatch = body.match(/<link\b[^>]*\brel=["'](?:service-doc|openapi|swagger)["'][^>]*\bhref=["']([^"']+)["']/i);
        if (linkMatch) {
          candidateUrls.push(new URL(linkMatch[1], targetUrl).href);
        }

        // Redoc <redoc spec-url="..."> or Stoplight <elements-api apiDescriptionUrl="...">
        const docElemMatch = body.match(/(?:spec-url|apiDescriptionUrl|data-url)=["']([^"']+)["']/i);
        if (docElemMatch) {
          candidateUrls.push(new URL(docElemMatch[1], targetUrl).href);
        }

        // SwaggerUIBundle({ url: "..." }) or Swagger UI JSON config
        const swaggerUrlMatch = body.match(/url:\s*["']([^"']+\.(?:json|ya?ml)(?:\?[^"']*)?)["']/i);
        if (swaggerUrlMatch) {
          candidateUrls.push(new URL(swaggerUrlMatch[1], targetUrl).href);
        }

        // Any inline URLs ending in openapi.json, openapi.yaml, swagger.json, spec.json
        const specRegex = /(?:https?:\/\/[^\s"'`<>]+|\/[^\s"'`<>]+)\/(?:openapi|swagger|api-docs?|spec(?:3)?|rest-api)(?:\.[a-z0-9]+)?\.(?:json|ya?ml)(?:\?[^\s"'`<>]*)?/gi;
        let sm: RegExpExecArray | null;
        while ((sm = specRegex.exec(body)) !== null) {
          try {
            candidateUrls.push(new URL(sm[0], targetUrl).href);
          } catch {}
        }
      }
    } catch {
      // Continue
    }

    // 2. Authoritative OpenAPI Catalog for major developer ecosystems
    const AUTHORITATIVE_CATALOG: Record<string, string[]> = {
      'stripe.com': ['https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json'],
      'github.com': ['https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json'],
      'twilio.com': ['https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/yaml/twilio_api_v2010.yaml'],
      'slack.com': ['https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json'],
      'openai.com': ['https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml'],
      'digitalocean.com': ['https://raw.githubusercontent.com/digitalocean/openapi/main/specification/DigitalOcean-public.v2.yaml'],
      'postman.com': ['https://raw.githubusercontent.com/postmanlabs/postman-docs-openapi/main/specs/postman-api.json'],
      'box.com': ['https://raw.githubusercontent.com/box/box-openapi/main/openapi.json'],
      'dropbox.com': ['https://raw.githubusercontent.com/dropbox/dropbox-api-spec/master/openapi.json'],
      'cloudflare.com': ['https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json'],
      'datadog.com': ['https://raw.githubusercontent.com/DataDog/datadog-api-client-typescript/master/schemas/v2/openapi.json'],
      'spotify.com': ['https://raw.githubusercontent.com/sonallux/spotify-web-api/main/fixed-spec.json'],
    };

    for (const [domain, specs] of Object.entries(AUTHORITATIVE_CATALOG)) {
      if (baseUrl.hostname.includes(domain)) {
        candidateUrls.push(...specs);
      }
    }

    // 3. Standard candidate paths on target origin
    for (const path of candidatePaths) {
      candidateUrls.push(new URL(path, baseUrl.origin).href);
    }

    const seenUrls = new Set<string>();
    for (const probeUrl of candidateUrls) {
      if (seenUrls.has(probeUrl)) continue;
      seenUrls.add(probeUrl);

      try {
        const res = await fetcher.fetch(probeUrl, {
          timeoutMs: 8000,
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
