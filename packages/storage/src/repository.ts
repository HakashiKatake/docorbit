import {
  computeSha256,
} from '../../shared/src/index.ts';
import type {
  DiscoveredSource,
  NormalizedPage,
  Heading,
  Link,
  CodeExample,
  SecurityAnnotation,
  Provenance,
} from '../../shared/src/index.ts';
import { DocRouterDb } from './db.ts';

export class DocRouterRepository {
  private db: DocRouterDb;

  constructor(db: DocRouterDb) {
    this.db = db;
  }

  saveSource(source: DiscoveredSource): string {
    const raw = this.db.getRawDb();
    const id = `src_${computeSha256(source.url).slice(0, 16)}`;
    const createdAt = new Date().toISOString();

    const stmt = raw.prepare(`
      INSERT INTO sources (
        id, url, type, discovered_by, status, content_type,
        confidence, authority, machine_readable, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        type = excluded.type,
        discovered_by = excluded.discovered_by,
        status = excluded.status,
        content_type = excluded.content_type,
        confidence = excluded.confidence,
        authority = excluded.authority,
        machine_readable = excluded.machine_readable,
        metadata = excluded.metadata
    `);

    stmt.run(
      id,
      source.url,
      source.type,
      source.discoveredBy,
      source.status,
      source.contentType || null,
      source.confidence,
      source.authority,
      source.machineReadable ? 1 : 0,
      source.metadata ? JSON.stringify(source.metadata) : null,
      createdAt
    );

    const row = raw.prepare('SELECT id FROM sources WHERE url = ?').get(source.url) as { id: string } | undefined;
    return row?.id || id;
  }

  getSource(id: string): (DiscoveredSource & { id: string }) | null {
    const raw = this.db.getRawDb();
    const row = raw.prepare('SELECT * FROM sources WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapSourceRow(row);
  }

  getSourceByUrl(url: string): (DiscoveredSource & { id: string }) | null {
    const raw = this.db.getRawDb();
    const row = raw.prepare('SELECT * FROM sources WHERE url = ?').get(url) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapSourceRow(row);
  }

  listSources(): Array<DiscoveredSource & { id: string; createdAt: string }> {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT * FROM sources ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    return rows.map(r => ({
      ...this.mapSourceRow(r),
      createdAt: String(r.created_at),
    }));
  }

  savePage(page: NormalizedPage): void {
    const raw = this.db.getRawDb();

    const pageStmt = raw.prepare(`
      INSERT INTO pages (
        id, source_id, title, url, content, content_hash,
        fetched_at, raw_bytes, estimated_tokens,
        headings_json, security_annotations_json, provenance_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        content_hash = excluded.content_hash,
        fetched_at = excluded.fetched_at,
        raw_bytes = excluded.raw_bytes,
        estimated_tokens = excluded.estimated_tokens,
        headings_json = excluded.headings_json,
        security_annotations_json = excluded.security_annotations_json,
        provenance_json = excluded.provenance_json
    `);

    pageStmt.run(
      page.id,
      page.sourceId,
      page.title,
      page.url,
      page.content,
      page.contentHash,
      page.fetchedAt,
      page.rawBytes,
      page.estimatedTokens,
      JSON.stringify(page.headings),
      JSON.stringify(page.securityAnnotations),
      page.provenance ? JSON.stringify(page.provenance) : null
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

  countPages(sourceId?: string): number {
    const raw = this.db.getRawDb();
    if (sourceId) {
      const row = raw.prepare('SELECT COUNT(*) as count FROM pages WHERE source_id = ?').get(sourceId) as { count: number };
      return row?.count || 0;
    }
    const row = raw.prepare('SELECT COUNT(*) as count FROM pages').get() as { count: number };
    return row?.count || 0;
  }

  createSnapshot(sourceId: string, metadata?: Record<string, unknown>): string {
    const raw = this.db.getRawDb();
    const pages = raw.prepare('SELECT id, content_hash FROM pages WHERE source_id = ? ORDER BY id ASC').all(sourceId) as Array<{ id: string; content_hash: string }>;

    const combinedHash = computeSha256(pages.map(p => p.content_hash).join(':'));
    const snapshotId = `snap_${combinedHash.slice(0, 16)}`;
    const now = new Date().toISOString();

    const stmt = raw.prepare(`
      INSERT INTO snapshots (id, source_id, snapshot_hash, page_count, captured_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        captured_at = excluded.captured_at,
        page_count = excluded.page_count,
        metadata = excluded.metadata
    `);

    stmt.run(
      snapshotId,
      sourceId,
      combinedHash,
      pages.length,
      now,
      metadata ? JSON.stringify(metadata) : null
    );

    // Link snapshot to page membership in snapshot_pages
    const linkStmt = raw.prepare(`
      INSERT OR REPLACE INTO snapshot_pages (snapshot_id, page_id, content_hash)
      VALUES (?, ?, ?)
    `);
    for (const p of pages) {
      linkStmt.run(snapshotId, p.id, p.content_hash);
    }

    return snapshotId;
  }

  getSnapshot(snapshotId: string): { id: string; sourceId: string; snapshotHash: string; pageCount: number; capturedAt: string; metadata?: Record<string, unknown> } | null {
    const raw = this.db.getRawDb();
    const row = raw.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      sourceId: String(row.source_id),
      snapshotHash: String(row.snapshot_hash),
      pageCount: Number(row.page_count),
      capturedAt: String(row.captured_at),
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : undefined,
    };
  }

  getSnapshotPages(snapshotId: string): NormalizedPage[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare(`
      SELECT p.* FROM pages p
      JOIN snapshot_pages sp ON p.id = sp.page_id
      WHERE sp.snapshot_id = ?
      ORDER BY p.id ASC
    `).all(snapshotId) as Array<Record<string, unknown>>;
    return rows.map(r => this.hydratePage(r));
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

  private mapSourceRow(row: Record<string, unknown>): DiscoveredSource & { id: string } {
    return {
      id: String(row.id),
      url: String(row.url),
      type: row.type as any,
      discoveredBy: String(row.discovered_by),
      status: row.status as any,
      contentType: row.content_type ? String(row.content_type) : undefined,
      confidence: Number(row.confidence),
      authority: row.authority as any,
      machineReadable: Number(row.machine_readable) === 1,
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : undefined,
    };
  }

  private hydratePage(row: Record<string, unknown>): NormalizedPage {
    const raw = this.db.getRawDb();
    const pageId = String(row.id);

    const linkRows = raw.prepare('SELECT text, url, is_external FROM links WHERE page_id = ?').all(pageId) as Array<Record<string, unknown>>;
    const links: Link[] = linkRows.map(lr => ({
      text: String(lr.text),
      url: String(lr.url),
      isExternal: Number(lr.is_external) === 1,
    }));

    const codeRows = raw.prepare('SELECT id, language, code, caption FROM code_examples WHERE page_id = ?').all(pageId) as Array<Record<string, unknown>>;
    const codeExamples: CodeExample[] = codeRows.map(cr => ({
      id: String(cr.id),
      language: String(cr.language),
      code: String(cr.code),
      caption: cr.caption ? String(cr.caption) : undefined,
    }));

    const headings: Heading[] = row.headings_json ? JSON.parse(String(row.headings_json)) : [];
    const securityAnnotations: SecurityAnnotation[] = row.security_annotations_json ? JSON.parse(String(row.security_annotations_json)) : [];
    const provenance: Provenance | undefined = row.provenance_json ? JSON.parse(String(row.provenance_json)) : undefined;

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
    };
  }
}
