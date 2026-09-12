import type {
  NormalizedPage,
  Link,
  CodeExample,
  Heading,
  SecurityAnnotation,
  Provenance,
  PageType,
  DocumentationTreeNode,
} from '../../../shared/src/index.ts';
import type { DocOrbitDb } from '../db.ts';

export class PageRepository {
  private db: DocOrbitDb;

  constructor(db: DocOrbitDb) {
    this.db = db;
  }

  savePage(page: NormalizedPage): void {
    const raw = this.db.getRawDb();

    const pageStmt = raw.prepare(`
      INSERT INTO pages (
        id, source_id, title, url, content, content_hash,
        fetched_at, raw_bytes, estimated_tokens,
        headings_json, security_annotations_json, provenance_json,
        page_type, parent_url, category, breadcrumb_json, depth, discovery_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        content_hash = excluded.content_hash,
        fetched_at = excluded.fetched_at,
        raw_bytes = excluded.raw_bytes,
        estimated_tokens = excluded.estimated_tokens,
        headings_json = excluded.headings_json,
        security_annotations_json = excluded.security_annotations_json,
        provenance_json = excluded.provenance_json,
        page_type = excluded.page_type,
        parent_url = excluded.parent_url,
        category = excluded.category,
        breadcrumb_json = excluded.breadcrumb_json,
        depth = excluded.depth,
        discovery_method = excluded.discovery_method
    `);

    pageStmt.run(
      page.id,
      page.sourceId || null,
      page.title,
      page.url,
      page.content,
      page.contentHash,
      page.fetchedAt,
      page.rawBytes,
      page.estimatedTokens,
      JSON.stringify(page.headings),
      JSON.stringify(page.securityAnnotations),
      page.provenance ? JSON.stringify(page.provenance) : null,
      page.pageType || null,
      page.parentUrl || null,
      page.category || null,
      page.breadcrumb ? JSON.stringify(page.breadcrumb) : null,
      page.depth ?? null,
      page.discoveryMethod || null
    );

    raw.prepare('DELETE FROM links WHERE page_id = ?').run(page.id);
    const linkStmt = raw.prepare(`
      INSERT INTO links (id, page_id, text, url, is_external)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < page.links.length; i++) {
      const link = page.links[i];
      const linkId = `${page.id}_link_${i}`;
      linkStmt.run(linkId, page.id, link.text, link.url, link.isExternal ? 1 : 0);
    }

    raw.prepare('DELETE FROM code_examples WHERE page_id = ?').run(page.id);
    const codeStmt = raw.prepare(`
      INSERT INTO code_examples (id, page_id, language, code, caption)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < page.codeExamples.length; i++) {
      const example = page.codeExamples[i];
      const exampleId = `${page.id}_code_${i}`;
      codeStmt.run(exampleId, page.id, example.language, example.code, example.caption || null);
    }

    if (this.db.isFtsAvailable()) {
      try {
        raw.prepare('DELETE FROM pages_fts WHERE page_id = ?').run(page.id);
        raw.prepare(`
          INSERT INTO pages_fts (page_id, title, content)
          VALUES (?, ?, ?)
        `).run(page.id, page.title, page.content);
      } catch {
        // Continue
      }
    }
  }

  getPage(id: string): NormalizedPage | null {
    const raw = this.db.getRawDb();
    const row = raw.prepare('SELECT * FROM pages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.hydratePage(row);
  }

  getPageByUrl(url: string): NormalizedPage | null {
    const raw = this.db.getRawDb();
    const row = raw.prepare('SELECT * FROM pages WHERE url = ?').get(url) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.hydratePage(row);
  }

  getPagesBySource(sourceId: string): NormalizedPage[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT * FROM pages WHERE source_id = ? ORDER BY fetched_at ASC').all(sourceId) as Array<Record<string, unknown>>;
    return rows.map(r => this.hydratePage(r));
  }

  listPages(limit: number = 50, offset: number = 0): NormalizedPage[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT * FROM pages ORDER BY fetched_at DESC LIMIT ? OFFSET ?').all(limit, offset) as Array<Record<string, unknown>>;
    return rows.map(r => this.hydratePage(r));
  }

  countPages(sourceId?: string): number {
    const raw = this.db.getRawDb();
    if (sourceId) {
      const row = raw.prepare('SELECT COUNT(*) as count FROM pages WHERE source_id = ?').get(sourceId) as { count: number };
      return row?.count || 0;
    }
    const row = raw.prepare('SELECT COUNT(*) as count FROM pages').get() as { count: number };
    return row?.count || 0;
  }

  searchPagesFts(query: string, limit: number = 10): NormalizedPage[] {
    if (!this.db.isFtsAvailable()) {
      return [];
    }

    const raw = this.db.getRawDb();
    const sanitizedQuery = `"${query.replace(/"/g, '""')}"`;

    try {
      const rows = raw.prepare(`
        SELECT p.* FROM pages p
        JOIN pages_fts fts ON p.id = fts.page_id
        WHERE pages_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(sanitizedQuery, limit) as Array<Record<string, unknown>>;

      return rows.map(r => this.hydratePage(r));
    } catch {
      return [];
    }
  }

  getPageLinks(pageId: string): string[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT url FROM links WHERE page_id = ?').all(pageId) as Array<Record<string, unknown>>;
    return rows.map(r => String(r.url));
  }

  savePageLinks(pageId: string, targetUrls: string[]): void {
    const raw = this.db.getRawDb();
    raw.prepare('DELETE FROM links WHERE page_id = ?').run(pageId);
    const stmt = raw.prepare('INSERT OR IGNORE INTO links (id, page_id, text, url, is_external) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < targetUrls.length; i++) {
      stmt.run(`${pageId}_link_${i}`, pageId, '', targetUrls[i], 0);
    }
  }

  hydratePage(row: Record<string, unknown>, shallow = false): NormalizedPage {
    const raw = this.db.getRawDb();
    const pageId = String(row.id);

    let links: Link[] = [];
    let codeExamples: CodeExample[] = [];

    if (!shallow) {
      const linkRows = raw.prepare('SELECT text, url, is_external FROM links WHERE page_id = ?').all(pageId) as Array<Record<string, unknown>>;
      links = linkRows.map(lr => ({
        text: String(lr.text),
        url: String(lr.url),
        isExternal: Number(lr.is_external) === 1,
      }));

      const codeRows = raw.prepare('SELECT id, language, code, caption FROM code_examples WHERE page_id = ?').all(pageId) as Array<Record<string, unknown>>;
      codeExamples = codeRows.map(cr => ({
        id: String(cr.id),
        language: String(cr.language),
        code: String(cr.code),
        caption: cr.caption ? String(cr.caption) : undefined,
      }));
    }

    const headings: Heading[] = row.headings_json ? JSON.parse(String(row.headings_json)) : [];
    const securityAnnotations: SecurityAnnotation[] = row.security_annotations_json ? JSON.parse(String(row.security_annotations_json)) : [];
    const provenance: Provenance | undefined = row.provenance_json ? JSON.parse(String(row.provenance_json)) : undefined;
    const breadcrumb: string[] | undefined = row.breadcrumb_json ? JSON.parse(String(row.breadcrumb_json)) : undefined;

    return {
      id: pageId,
      sourceId: String(row.source_id),
      title: String(row.title),
      url: String(row.url),
      content: String(row.content),
      headings,
      links,
      codeExamples,
      contentHash: String(row.content_hash),
      fetchedAt: String(row.fetched_at),
      rawBytes: Number(row.raw_bytes),
      estimatedTokens: Number(row.estimated_tokens),
      securityAnnotations,
      provenance,
      pageType: (row.page_type as PageType) || undefined,
      parentUrl: row.parent_url ? String(row.parent_url) : undefined,
      category: row.category ? String(row.category) : undefined,
      breadcrumb,
      depth: typeof row.depth === 'number' ? row.depth : undefined,
      discoveryMethod: row.discovery_method ? String(row.discovery_method) : undefined,
    };
  }

  getDocumentTree(sourceId?: string): DocumentationTreeNode | null {
    const raw = this.db.getRawDb();
    const query = sourceId
      ? 'SELECT * FROM pages WHERE source_id = ? ORDER BY depth ASC, fetched_at ASC'
      : 'SELECT * FROM pages ORDER BY depth ASC, fetched_at ASC';
    const rows = (sourceId ? raw.prepare(query).all(sourceId) : raw.prepare(query).all()) as Array<Record<string, unknown>>;

    if (rows.length === 0) return null;

    const pages = rows.map(r => this.hydratePage(r, true));
    // Find root page: either depth === 0, or shortest URL
    const rootPage = pages.find(p => p.depth === 0) || pages[0];

    const nodeMap = new Map<string, DocumentationTreeNode>();
    for (const p of pages) {
      nodeMap.set(p.url, {
        url: p.url,
        title: p.title,
        parentUrl: p.parentUrl,
        category: p.category,
        breadcrumb: p.breadcrumb || [],
        depth: p.depth ?? 0,
        pageType: p.pageType,
        priority: 'nav_sidebar',
        discoveryMethod: p.discoveryMethod || 'stored',
        children: [],
      });
    }

    const rootNode = nodeMap.get(rootPage.url)!;
    for (const [url, node] of nodeMap.entries()) {
      if (url === rootPage.url) continue;
      const parentUrl = node.parentUrl;
      if (parentUrl && nodeMap.has(parentUrl)) {
        const parent = nodeMap.get(parentUrl)!;
        if (!parent.children.some(c => c.url === node.url)) {
          parent.children.push(node);
        }
      } else {
        if (!rootNode.children.some(c => c.url === node.url)) {
          rootNode.children.push(node);
        }
      }
    }

    return rootNode;
  }
}
