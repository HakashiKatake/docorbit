import type { DocumentationSiteDetection } from '../../shared/src/index.ts';

export class DocumentationSiteDetector {
  /**
   * Evaluates deterministic signals to determine if a URL and its HTML represent a documentation site.
   */
  detect(urlStr: string, html: string, status = 200, _headers: Record<string, string> = {}): DocumentationSiteDetection {
    if (status < 200 || status >= 400 || !html) {
      return {
        isDocumentation: false,
        confidence: 0.0,
        explanation: `Unreachable or error status code (${status})`,
        signals: {
          hasDocTitle: false,
          hasNavOrSidebar: false,
          hasBreadcrumbs: false,
          hasApiTerminology: false,
          hasCodeBlocks: false,
          hasEndpointPatterns: false,
          hasDocsFramework: false,
          hasDocUrlPattern: false,
          internalDocLinkDensity: 0.0,
        },
      };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr);
    } catch {
      return {
        isDocumentation: false,
        confidence: 0.0,
        explanation: 'Invalid URL',
        signals: {
          hasDocTitle: false,
          hasNavOrSidebar: false,
          hasBreadcrumbs: false,
          hasApiTerminology: false,
          hasCodeBlocks: false,
          hasEndpointPatterns: false,
          hasDocsFramework: false,
          hasDocUrlPattern: false,
          internalDocLinkDensity: 0.0,
        },
      };
    }

    const pathname = parsedUrl.pathname.toLowerCase();
    const htmlLower = html.toLowerCase();

    // 1. Doc URL pattern
    const hasDocUrlPattern = /\/(?:docs?|documentation|api[\/_-]docs?|api[\/_-]reference|developers?|guides?|manual|reference)(?:\/|$)/i.test(pathname);

    // 2. Title & H1 extraction
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const h1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';
    const combinedTitle = `${title} ${h1}`.toLowerCase();

    const hasDocTitle = /(?:documentation|api reference|api docs?|developer|guides?|quickstart|sdk reference|api manual)/i.test(combinedTitle);

    // 3. Navigation / Sidebar structure
    const hasNavOrSidebar =
      /<nav\b/i.test(html) ||
      /\b(?:sidebar|sphinxsidebar|toctree|md-nav|menu-list|docs-nav|navigation-tree)\b/i.test(html) ||
      /<aside\b/i.test(html) ||
      /role=["']navigation["']/i.test(html) ||
      /<ul\b[^>]*class=["'][^"']*(?:nav|tree|sidebar|menu)[^"']*["']/i.test(html);

    // 4. Breadcrumbs
    const hasBreadcrumbs =
      /\bbreadcrumb(?:s)?\b/i.test(html) ||
      /aria-label=["']breadcrumb["']/i.test(html);

    // 5. Code blocks
    const hasCodeBlocks =
      /<pre\b[^>]*><code/i.test(html) ||
      /\b(?:highlight-|language-)\w+/i.test(html) ||
      /```[a-z]+/i.test(html) ||
      /class=["'][^"']*\bcode-block\b/i.test(html);

    // 6. Endpoint patterns & HTTP methods
    const hasEndpointPatterns =
      /\b(GET|POST|PUT|DELETE|PATCH)\s+(?:\/v\d+[\w\/-]*|\/api[\w\/-]*)/i.test(html) ||
      /\b(?:curl\s+-X|request\s+body|response\s+body|status\s+code\s+200)\b/i.test(html) ||
      /\b(200 OK|400 Bad Request|401 Unauthorized|404 Not Found)\b/i.test(html);

    // 7. API Terminology
    const apiTerms = [
      'endpoint',
      'authentication',
      'rate limit',
      'bearer token',
      'api key',
      'query parameter',
      'request payload',
      'json body',
      'webhook',
      'header',
    ];
    const matchedTerms = apiTerms.filter(term => htmlLower.includes(term));
    const hasApiTerminology = matchedTerms.length >= 2;

    // 8. Docs Framework Markers
    let framework: string | undefined;
    if (/sphinx|sphinxsidebar|DOCUMENTATION_OPTIONS/i.test(html)) {
      framework = 'sphinx';
    } else if (/__docusaurus|docusaurus-plugin|docusaurus/i.test(html)) {
      framework = 'docusaurus';
    } else if (/mkdocs|md-nav|data-md-component=["']navigation/i.test(html)) {
      framework = 'mkdocs';
    } else if (/gitbook|__gitbook/i.test(html)) {
      framework = 'gitbook';
    } else if (/_mintlify|mintlify\.css/i.test(html)) {
      framework = 'mintlify';
    } else if (/__nextra/i.test(html)) {
      framework = 'nextra';
    } else if (/__vp_site_data__|vitepress/i.test(html)) {
      framework = 'vitepress';
    } else if (/<redoc\b|redoc-container/i.test(html)) {
      framework = 'redoc';
    } else if (/swagger-ui/i.test(html)) {
      framework = 'swagger_ui';
    }

    const hasDocsFramework = framework !== undefined;

    // 9. Internal Doc Link Density
    let internalDocLinks = 0;
    let totalLinks = 0;
    const linkRegex = /href=["']([^"'#?]+)["']/gi;
    let lMatch: RegExpExecArray | null;
    while ((lMatch = linkRegex.exec(html)) !== null) {
      const rawHref = lMatch[1];
      if (rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:')) continue;
      totalLinks++;
      try {
        const resolved = new URL(rawHref, urlStr);
        if (resolved.origin === parsedUrl.origin) {
          if (
            resolved.pathname.startsWith(parsedUrl.pathname) ||
            hasDocUrlPattern ||
            /\/(?:docs?|api|guides?|reference)/i.test(resolved.pathname)
          ) {
            internalDocLinks++;
          }
        }
      } catch {}
    }

    const internalDocLinkDensity = totalLinks > 0 ? internalDocLinks / totalLinks : 0;

    // Calculate score
    let score = 0;
    const explanations: string[] = [];

    if (hasDocsFramework) {
      score += 0.35;
      const formattedFramework = framework.charAt(0).toUpperCase() + framework.slice(1);
      explanations.push(`Detected documentation framework: ${formattedFramework}`);
    }
    if (hasDocUrlPattern) {
      score += 0.25;
      explanations.push('URL conforms to documentation directory pattern');
    }
    if (hasDocTitle) {
      score += 0.20;
      explanations.push('Page title/heading contains documentation keywords');
    }
    if (hasNavOrSidebar) {
      score += 0.20;
      explanations.push('Navigation/sidebar hierarchy present');
    }
    if (hasCodeBlocks) {
      score += 0.15;
      explanations.push('Technical code blocks detected');
    }
    if (hasEndpointPatterns || hasApiTerminology) {
      score += 0.15;
      explanations.push('API endpoints and technical terminology detected');
    }
    if (hasBreadcrumbs) {
      score += 0.05;
      explanations.push('Hierarchical breadcrumb navigation');
    }
    if (internalDocLinkDensity > 0.3) {
      score += 0.10;
      explanations.push(`High internal documentation link density (${Math.round(internalDocLinkDensity * 100)}%)`);
    }

    const confidence = Math.min(1.0, Math.max(0.0, score));
    const isDocumentation = confidence >= 0.40;

    // Determine documentation type
    let documentationType: 'api_reference' | 'guide' | 'general' | 'sdk' = 'general';
    if (
      hasEndpointPatterns ||
      matchedTerms.includes('endpoint') ||
      matchedTerms.includes('api key') ||
      matchedTerms.includes('webhook') ||
      /\bapi\b/i.test(combinedTitle) ||
      /\bapi\b/i.test(parsedUrl.pathname)
    ) {
      documentationType = 'api_reference';
    } else if (/guide|tutorial|quickstart/i.test(combinedTitle)) {
      documentationType = 'guide';
    } else if (/sdk|client library/i.test(combinedTitle)) {
      documentationType = 'sdk';
    }

    // Extract doc version evidence if present (e.g. "v2.0", "v1.4", "Version 2.0")
    let docVersion: string | undefined;
    const versionMatch = html.match(/\b(?:v(?:ersion)?\s*|api\s+v)(\d+\.\d+(?:\.\d+)?|\d+)/i);
    if (versionMatch) {
      docVersion = `v${versionMatch[1]}`;
    }

    const explanation = explanations.length > 0
      ? explanations.join('; ')
      : 'Insufficient documentation signals';

    return {
      isDocumentation,
      confidence,
      explanation,
      framework,
      documentationType,
      docVersion,
      signals: {
        hasDocTitle,
        hasNavOrSidebar,
        hasBreadcrumbs,
        hasApiTerminology,
        hasCodeBlocks,
        hasEndpointPatterns,
        hasDocsFramework,
        hasDocUrlPattern,
        internalDocLinkDensity,
      },
    };
  }
}
