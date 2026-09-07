import { computeSha256 } from '../../../shared/src/index.ts';
import type { DiscoveredSource, NormalizedPage } from '../../../shared/src/index.ts';
import type { DocOrbitDb } from '../db.ts';

export interface SnapshotRecord {
  id: string;
  sourceId: string;
  snapshotHash: string;
  pageCount: number;
  capturedAt: string;
  docVersion?: string;
  metadata?: Record<string, unknown>;
}

export class SourceRepository {
  private db: DocOrbitDb;
  private hydratePageFn?: (row: Record<string, unknown>) => NormalizedPage;

  constructor(
    db: DocOrbitDb,
    hydratePageFn?: (row: Record<string, unknown>) => NormalizedPage
  ) {
    this.db = db;
    this.hydratePageFn = hydratePageFn;
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
      source.discoveredBy || 'manual',
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

  createSnapshot(sourceId: string, metadata?: Record<string, unknown>, docVersion?: string): string {
    const raw = this.db.getRawDb();
    const pages = raw.prepare('SELECT id, content_hash FROM pages WHERE source_id = ? ORDER BY id ASC').all(sourceId) as Array<{ id: string; content_hash: string }>;

    const combinedHash = computeSha256(pages.map(p => p.content_hash).join(':'));
    const snapshotId = `snap_${combinedHash.slice(0, 16)}`;
    const now = new Date().toISOString();
    const version = docVersion || (metadata?.docVersion as string) || null;

    const stmt = raw.prepare(`
      INSERT INTO snapshots (id, source_id, snapshot_hash, page_count, captured_at, doc_version, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        captured_at = excluded.captured_at,
        page_count = excluded.page_count,
        doc_version = COALESCE(excluded.doc_version, snapshots.doc_version),
        metadata = excluded.metadata
    `);

    stmt.run(
      snapshotId,
      sourceId,
      combinedHash,
      pages.length,
      now,
      version,
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

  linkSnapshotPages(snapshotId: string, pageIds: string[]): void {
    const raw = this.db.getRawDb();
    const linkStmt = raw.prepare(`
      INSERT OR REPLACE INTO snapshot_pages (snapshot_id, page_id, content_hash)
      VALUES (?, ?, COALESCE((SELECT content_hash FROM pages WHERE id = ?), 'hash_default'))
    `);
    for (const pageId of pageIds) {
      linkStmt.run(snapshotId, pageId, pageId);
    }
  }

  getSnapshot(snapshotId: string): SnapshotRecord | null {
    const raw = this.db.getRawDb();
    const row = raw.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      sourceId: String(row.source_id),
      snapshotHash: String(row.snapshot_hash),
      pageCount: Number(row.page_count),
      capturedAt: String(row.captured_at),
      docVersion: row.doc_version ? String(row.doc_version) : undefined,
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : undefined,
    };
  }

  listSnapshots(sourceId?: string): SnapshotRecord[] {
    const raw = this.db.getRawDb();
    let sql = 'SELECT * FROM snapshots';
    const params: unknown[] = [];
    if (sourceId) {
      sql += ' WHERE source_id = ?';
      params.push(sourceId);
    }
    sql += ' ORDER BY captured_at DESC';
    const rows = raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: String(row.id),
      sourceId: String(row.source_id),
      snapshotHash: String(row.snapshot_hash),
      pageCount: Number(row.page_count),
      capturedAt: String(row.captured_at),
      docVersion: row.doc_version ? String(row.doc_version) : undefined,
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : undefined,
    }));
  }

  getSnapshotPages(snapshotId: string): NormalizedPage[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare(`
      SELECT p.* FROM pages p
      JOIN snapshot_pages sp ON p.id = sp.page_id
      WHERE sp.snapshot_id = ?
      ORDER BY p.id ASC
    `).all(snapshotId) as Array<Record<string, unknown>>;
    if (this.hydratePageFn) {
      return rows.map(r => this.hydratePageFn!(r));
    }
    return [];
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
}
