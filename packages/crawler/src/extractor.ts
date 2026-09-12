import type { ExtractedDocLink, LinkPriority } from '../../shared/src/index.ts';

export interface ExtractedLinksResult {
  links: ExtractedDocLink[];
  categories: string[];
  breadcrumbs: string[];
  framework?: string;
}

export class DocumentationLinkExtractor {
  /**
   * Extracts links from HTML with prioritization, hierarchy detection,
   * collapsed navigation extraction, and embedded framework JSON inspection.
   */
  extract(html: string, currentUrl: string): ExtractedLinksResult {
    const rawLinks: ExtractedDocLink[] = [];
    const categories: string[] = [];
    let breadcrumbs: string[] = [];
    let baseUrl: URL;

    try {
      baseUrl = new URL(currentUrl);
    } catch {
      return { links: [], categories: [], breadcrumbs: [] };
    }

    // 1. Extract Breadcrumbs
    const breadcrumbRegex = /<(?:ol|ul|nav|div)\b[^>]*(?:class|aria-label)=["'][^"']*\bbreadcrumb[s]?[^"']*["'][^>]*>([\s\S]*?)<\/(?:ol|ul|nav|div)>/gi;
    let bMatch: RegExpExecArray | null;
    while ((bMatch = breadcrumbRegex.exec(html)) !== null) {
      const bHtml = bMatch[1];
      const crumbItems = bHtml.match(/<(?:li|a|span)\b[^>]*>([\s\S]*?)<\/(?:li|a|span)>/gi);
      if (crumbItems) {
        breadcrumbs = crumbItems
          .map(item => item.replace(/<[^>]+>/g, '').trim())
          .filter(t => t && t !== '/' && t !== '>' && t !== '»');
      }

      // Extract links inside breadcrumb
      const bLinkRegex = /<a\b[^>]*\bhref=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let blMatch: RegExpExecArray | null;
      while ((blMatch = bLinkRegex.exec(bHtml)) !== null) {
        const url = this.normalizeUrl(blMatch[1], currentUrl);
        if (url) {
          rawLinks.push({
            url,
            text: blMatch[2].replace(/<[^>]+>/g, '').trim(),
            priority: 'breadcrumb',
            parentUrl: currentUrl,
            breadcrumb: breadcrumbs,
            discoveryMethod: 'breadcrumb',
          });
        }
      }
    }

    // 2. Extract Collapsed / Expandable Navigation (<details>, .collapsed, style="display:none", etc.)
    const detailsRegex = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
    let dMatch: RegExpExecArray | null;
    while ((dMatch = detailsRegex.exec(html)) !== null) {
      const detailsContent = dMatch[1];
      const summaryMatch = detailsContent.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
      const categoryName = summaryMatch ? summaryMatch[1].replace(/<[^>]+>/g, '').trim() : undefined;
      if (categoryName && !categories.includes(categoryName)) {
        categories.push(categoryName);
      }

      const linkRegex = /<a\b[^>]*\bhref=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let dlMatch: RegExpExecArray | null;
      while ((dlMatch = linkRegex.exec(detailsContent)) !== null) {
        const url = this.normalizeUrl(dlMatch[1], currentUrl);
        if (url) {
          rawLinks.push({
            url,
            text: dlMatch[2].replace(/<[^>]+>/g, '').trim(),
            priority: 'nav_sidebar',
            parentUrl: currentUrl,
            category: categoryName,
            breadcrumb: categoryName ? [...breadcrumbs, categoryName] : breadcrumbs,
            discoveryMethod: 'collapsed_details',
            isCollapsed: true,
          });
        }
      }
    }

    // Hidden elements (.collapse, .hidden, display: none, aria-hidden="true")
    const hiddenElemRegex = /<(?:div|ul|li|section)\b[^>]*(?:class=["'][^"']*\b(?:collapse|collapsed|is-collapsed|hidden|d-none|menu-collapsed)\b[^"']*|style=["'][^"']*\bdisplay\s*:\s*none\b[^"']*|aria-hidden=["']true["'])[^>]*>([\s\S]*?)<\/(?:div|ul|li|section)>/gi;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = hiddenElemRegex.exec(html)) !== null) {
      const hiddenContent = hMatch[1];
      const linkRegex = /<a\b[^>]*\bhref=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let hlMatch: RegExpExecArray | null;
      while ((hlMatch = linkRegex.exec(hiddenContent)) !== null) {
        const url = this.normalizeUrl(hlMatch[1], currentUrl);
        if (url) {
          rawLinks.push({
            url,
            text: hlMatch[2].replace(/<[^>]+>/g, '').trim(),
            priority: 'nav_sidebar',
            parentUrl: currentUrl,
            discoveryMethod: 'collapsed_hidden',
            isCollapsed: true,
          });
        }
      }
    }

    // 3. Extract Sidebar & Navigation Containers (Sphinx, MkDocs, Docusaurus, standard <nav>, <aside>)
    const navContainersRegex = /<(nav|aside)\b([^>]*)>([\s\S]*?)<\/\1>|<(div|section|ul)\b([^>]*(?:class|id)=["'][^"']*\b(?:sidebar|sphinxsidebar|toctree|md-nav|docs-menu|table-of-contents|navigation)\b[^"']*[^>]*)>([\s\S]*?)<\/\4>/gi;
    let nMatch: RegExpExecArray | null;
    while ((nMatch = navContainersRegex.exec(html)) !== null) {
      const attrs = (nMatch[2] || nMatch[5] || '').toLowerCase();
      const navContent = nMatch[3] || nMatch[6];
      if (/\bbreadcrumb[s]?\b/.test(attrs) || /\bfooter\b/.test(attrs) || /\bpagination\b/.test(attrs)) {
        continue;
      }

      const extractedInThisContainer = new Set<string>();

      // Nested lists in navigation indicate categories and subpages
      const itemRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      let currentSection = '';

      while ((liMatch = itemRegex.exec(navContent)) !== null) {
        const liContent = liMatch[1];
        const isHeader = /<span\b[^>]*class=["'][^"']*(?:caption-text|nav-header|menu-label|category-title)[^"']*["']>([\s\S]*?)<\/span>/i.exec(liContent);
        if (isHeader) {
          currentSection = isHeader[1].replace(/<[^>]+>/g, '').trim();
          if (currentSection && !categories.includes(currentSection)) {
            categories.push(currentSection);
          }
        }

        const linkRegex = /<a\b[^>]*\bhref=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let lMatch: RegExpExecArray | null;
        while ((lMatch = linkRegex.exec(liContent)) !== null) {
          const url = this.normalizeUrl(lMatch[1], currentUrl);
          if (url) {
            extractedInThisContainer.add(url);
            const text = lMatch[2].replace(/<[^>]+>/g, '').trim();
            rawLinks.push({
              url,
              text,
              priority: 'nav_sidebar',
              parentUrl: currentUrl,
              category: currentSection || undefined,
              breadcrumb: currentSection ? [...breadcrumbs, currentSection] : breadcrumbs,
              discoveryMethod: 'sidebar_nav',
            });
          }
        }
      }

      // Also extract direct/unlisted links in this navigation container
      const directLinkRegex = /<a\b[^>]*\bhref=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let dLinkMatch: RegExpExecArray | null;
      while ((dLinkMatch = directLinkRegex.exec(navContent)) !== null) {
        const url = this.normalizeUrl(dLinkMatch[1], currentUrl);
        if (url && !extractedInThisContainer.has(url)) {
          extractedInThisContainer.add(url);
          const text = dLinkMatch[2].replace(/<[^>]+>/g, '').trim();
          rawLinks.push({
            url,
            text,
            priority: 'nav_sidebar',
            parentUrl: currentUrl,
            breadcrumb: breadcrumbs,
            discoveryMethod: 'sidebar_nav',
          });
        }
      }
    }

    // 4. Extract Previous / Next Pagination Links
    const prevNextRegex = /<a\b[^>]*\b(?:rel=["'](prev|next)["']|class=["'][^"']*\b(prev|next|pagination-item)[^"']*["'])[^>]*\bhref=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let pnMatch: RegExpExecArray | null;
    while ((pnMatch = prevNextRegex.exec(html)) !== null) {
      const url = this.normalizeUrl(pnMatch[3], currentUrl);
      if (url) {
        rawLinks.push({
          url,
          text: pnMatch[4].replace(/<[^>]+>/g, '').trim(),
          priority: 'prev_next',
          parentUrl: currentUrl,
          discoveryMethod: 'prev_next',
        });
      }
    }

    // 5. Extract Related Documentation Links
    const relatedRegex = /<(?:div|section)\b[^>]*(?:class|id)=["'][^"']*\b(?:related|see-also)\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/gi;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = relatedRegex.exec(html)) !== null) {
      const linkRegex = /<a\b[^>]*\bhref=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let rlMatch: RegExpExecArray | null;
      while ((rlMatch = linkRegex.exec(rMatch[1])) !== null) {
        const url = this.normalizeUrl(rlMatch[1], currentUrl);
        if (url) {
          rawLinks.push({
            url,
            text: rlMatch[2].replace(/<[^>]+>/g, '').trim(),
            priority: 'related',
            parentUrl: currentUrl,
            discoveryMethod: 'related_docs',
          });
        }
      }
    }

    // 6. Extract Embedded Framework Route Manifests & JSON Data
    // Next.js __NEXT_DATA__
    const nextDataMatch = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      try {
        const parsed = JSON.parse(nextDataMatch[1]);
        this.extractRoutesFromJson(parsed, currentUrl, rawLinks, 'embedded_next_data');
      } catch {}
    }

    // Embedded route manifests (e.g. routes: [...], nav: [...], items: [...])
    const scriptManifestRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = scriptManifestRegex.exec(html)) !== null) {
      const scriptBody = sMatch[1];
      if (scriptBody.includes('routes') || scriptBody.includes('sidebar') || scriptBody.includes('navigation')) {
        const routeStringMatches = scriptBody.matchAll(/["'](?:path|href|url|route)["']\s*:\s*["']([^"'#?]+)["']/g);
        for (const rm of routeStringMatches) {
          const path = rm[1];
          if (path.startsWith('/') || path.startsWith('http')) {
            const url = this.normalizeUrl(path, currentUrl);
            if (url) {
              rawLinks.push({
                url,
                text: path.split('/').filter(Boolean).pop() || path,
                priority: 'nav_sidebar',
                parentUrl: currentUrl,
                discoveryMethod: 'framework_route_manifest',
              });
            }
          }
        }
      }
    }

    // 7. Extract Body Prose Links (Lowest Priority within docs)
    const bodyLinkRegex = /<a\b[^>]*\bhref=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let bdyMatch: RegExpExecArray | null;
    while ((bdyMatch = bodyLinkRegex.exec(html)) !== null) {
      const rawHref = bdyMatch[1];
      const text = bdyMatch[2].replace(/<[^>]+>/g, '').trim();
      const url = this.normalizeUrl(rawHref, currentUrl);
      if (url) {
        rawLinks.push({
          url,
          text,
          priority: 'body',
          parentUrl: currentUrl,
          discoveryMethod: 'body_link',
        });
      }
    }

    // 8. Extract Markdown Links [Text](url)
    const mdLinkRegex = /\[([^\]]+)\]\(([^)"]+)(?:\s+"[^"]*")?\)/g;
    let mdMatch: RegExpExecArray | null;
    while ((mdMatch = mdLinkRegex.exec(html)) !== null) {
      const rawHref = mdMatch[2].trim();
      const text = mdMatch[1].trim();
      const url = this.normalizeUrl(rawHref, currentUrl);
      if (url) {
        rawLinks.push({
          url,
          text,
          priority: 'body',
          parentUrl: currentUrl,
          discoveryMethod: 'markdown_link',
        });
      }
    }

    // Deduplicate links prioritizing higher priority tiers
    const PRIORITY_ORDER: Record<LinkPriority, number> = {
      nav_sidebar: 1,
      breadcrumb: 2,
      category: 3,
      body: 4,
      prev_next: 5,
      related: 6,
      footer: 7,
      unknown: 8,
    };

    const linkMap = new Map<string, ExtractedDocLink>();
    for (const l of rawLinks) {
      const existing = linkMap.get(l.url);
      if (!existing) {
        linkMap.set(l.url, l);
      } else {
        const currentRank = PRIORITY_ORDER[l.priority] || 99;
        const existingRank = PRIORITY_ORDER[existing.priority] || 99;
        if (currentRank < existingRank) {
          linkMap.set(l.url, l);
        } else if (!existing.category && l.category) {
          existing.category = l.category;
        }
      }
    }

    return {
      links: Array.from(linkMap.values()),
      categories,
      breadcrumbs,
    };
  }

  private normalizeUrl(href: string, baseUrl: string): string | null {
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return null;
    }

    try {
      const resolved = new URL(href, baseUrl);
      if (!['http:', 'https:'].includes(resolved.protocol)) return null;

      // Strip anchor hashes
      resolved.hash = '';

      // Strip common tracking and session query parameters
      const paramsToStrip = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'ref', 'source', 'fbclid', 'gclid',
      ];
      for (const p of paramsToStrip) {
        resolved.searchParams.delete(p);
      }

      let pathname = resolved.pathname;
      // Strip trailing slash unless it's just '/'
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      resolved.pathname = pathname;

      return resolved.href;
    } catch {
      return null;
    }
  }

  private extractRoutesFromJson(
    obj: unknown,
    baseUrl: string,
    outLinks: ExtractedDocLink[],
    discoveryMethod: string,
    parentCategory?: string
  ): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.extractRoutesFromJson(item, baseUrl, outLinks, discoveryMethod, parentCategory);
      }
      return;
    }

    const record = obj as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title : typeof record.name === 'string' ? record.name : undefined;
    const category = typeof record.category === 'string' ? record.category : parentCategory || title;

    for (const key of ['path', 'href', 'url', 'route', 'slug']) {
      const val = record[key];
      if (typeof val === 'string' && (val.startsWith('/') || val.startsWith('http'))) {
        const url = this.normalizeUrl(val, baseUrl);
        if (url) {
          outLinks.push({
            url,
            text: title || val,
            priority: 'nav_sidebar',
            parentUrl: baseUrl,
            category,
            discoveryMethod,
          });
        }
      }
    }

    for (const val of Object.values(record)) {
      if (typeof val === 'object' && val !== null) {
        this.extractRoutesFromJson(val, baseUrl, outLinks, discoveryMethod, category);
      }
    }
  }
}
