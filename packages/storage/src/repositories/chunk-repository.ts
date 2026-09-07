import type {
  DocumentChunk,
  ChunkRelationship,
  ChunkCode,
  SymbolReference,
  ChunkType,
  Provenance,
} from '../../../shared/src/index.ts';
import type { DocOrbitDb } from '../db.ts';
import type { IChunkRepository } from '../interfaces.ts';

export class ChunkRepository implements IChunkRepository {
  private db: DocOrbitDb;

  constructor(db: DocOrbitDb) {
    this.db = db;
  }

  /**
   * Saves chunks, code snippets, symbols, and relationships in a single atomic transaction.
   * Transactionally synchronizes the FTS5 chunks_fts table with chunks.
   */
  saveChunks(
    chunks: DocumentChunk[],
    relationships: ChunkRelationship[] = [],
    codeSnippets: ChunkCode[] = [],
    symbols: SymbolReference[] = []
  ): void {
    if (chunks.length === 0) return;

    const raw = this.db.getRawDb();
    const createdAt = new Date().toISOString();

    // Group symbols by chunkId for fast indexing into chunks_fts
    const symbolsByChunk = new Map<string, string[]>();
    for (const s of symbols) {
      const list = symbolsByChunk.get(s.chunkId) || [];
      list.push(s.name);
      symbolsByChunk.set(s.chunkId, list);
    }

    raw.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const chunkStmt = raw.prepare(`
        INSERT INTO chunks (
          id, page_id, snapshot_id, title, section_path_json, content,
          chunk_type, language, token_estimate, ordinal, content_hash,
          doc_version, provenance_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          section_path_json = excluded.section_path_json,
          content = excluded.content,
          chunk_type = excluded.chunk_type,
          language = excluded.language,
          token_estimate = excluded.token_estimate,
          ordinal = excluded.ordinal,
          content_hash = excluded.content_hash,
          doc_version = excluded.doc_version,
          provenance_json = excluded.provenance_json
      `);

      const ftsDelStmt = this.db.isFtsAvailable()
        ? raw.prepare('DELETE FROM chunks_fts WHERE chunk_id = ?')
        : null;

      const ftsInsStmt = this.db.isFtsAvailable()
        ? raw.prepare(`
            INSERT INTO chunks_fts (chunk_id, title, section_path, content, symbols)
            VALUES (?, ?, ?, ?, ?)
          `)
        : null;

      for (const chunk of chunks) {
        const sectionPath = Array.isArray(chunk.sectionPath)
          ? chunk.sectionPath
          : (Array.isArray((chunk as any).headingPath) ? (chunk as any).headingPath : []);
        const chunkType = chunk.chunkType || (chunk as any).type || 'prose';
        const tokenEstimate = chunk.tokenEstimate ?? (chunk as any).tokenCount ?? 0;
        const ordinal = chunk.ordinal ?? (chunk as any).orderIndex ?? 0;
        const provenance = chunk.provenance ? JSON.stringify(chunk.provenance) : null;

        chunkStmt.run(
          chunk.id,
          chunk.pageId || null,
          chunk.snapshotId || 'default',
          chunk.title || null,
          JSON.stringify(sectionPath),
          chunk.content,
          chunkType,
          chunk.language || null,
          tokenEstimate,
          ordinal,
          chunk.contentHash,
          chunk.docVersion || null,
          provenance,
          createdAt
        );

        if (ftsDelStmt && ftsInsStmt) {
          ftsDelStmt.run(chunk.id);
          const chunkSymbols = symbolsByChunk.get(chunk.id)?.join(' ') || '';
          const sectionPathStr = sectionPath.join(' > ');
          ftsInsStmt.run(chunk.id, chunk.title || '', sectionPathStr, chunk.content, chunkSymbols);
        }
      }

      // Save code snippets
      if (codeSnippets.length > 0) {
        const codeStmt = raw.prepare(`
          INSERT OR REPLACE INTO chunk_code (id, chunk_id, language, code)
          VALUES (?, ?, ?, ?)
        `);
        for (const cs of codeSnippets) {
          codeStmt.run(cs.id, cs.chunkId, cs.language || null, cs.code);
        }
      }

      // Save symbols
      if (symbols.length > 0) {
        const symStmt = raw.prepare(`
          INSERT OR REPLACE INTO symbol_references (id, chunk_id, name, kind)
          VALUES (?, ?, ?, ?)
        `);
        for (const s of symbols) {
          symStmt.run(s.id, s.chunkId, s.name, s.kind);
        }
      }

      // Save relationships
      if (relationships.length > 0) {
        const relStmt = raw.prepare(`
          INSERT OR REPLACE INTO chunk_relationships (source_chunk_id, target_chunk_id, type)
          VALUES (?, ?, ?)
        `);
        for (const r of relationships) {
          relStmt.run(r.sourceChunkId, r.targetChunkId, r.type);
        }
      }

      raw.exec('COMMIT;');
    } catch (err) {
      raw.exec('ROLLBACK;');
      throw err;
    }
  }

  getChunk(id: string): DocumentChunk | null {
    const raw = this.db.getRawDb();
    const row = raw.prepare('SELECT * FROM chunks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.hydrateChunk(row);
  }

  getChunksByPage(pageId: string): DocumentChunk[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT * FROM chunks WHERE page_id = ? ORDER BY ordinal ASC').all(pageId) as Array<Record<string, unknown>>;
    return rows.map(r => this.hydrateChunk(r));
  }

  getChunksBySnapshot(snapshotId: string): DocumentChunk[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT * FROM chunks WHERE snapshot_id = ? ORDER BY page_id ASC, ordinal ASC').all(snapshotId) as Array<Record<string, unknown>>;
    return rows.map(r => this.hydrateChunk(r));
  }

  getChunksByVersion(docVersion: string): DocumentChunk[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT * FROM chunks WHERE doc_version = ? ORDER BY page_id ASC, ordinal ASC').all(docVersion) as Array<Record<string, unknown>>;
    return rows.map(r => this.hydrateChunk(r));
  }

  getChunkCode(chunkId: string): ChunkCode[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT id, chunk_id, language, code FROM chunk_code WHERE chunk_id = ?').all(chunkId) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: String(r.id),
      chunkId: String(r.chunk_id),
      language: r.language ? String(r.language) : undefined,
      code: String(r.code),
    }));
  }

  getChunkSymbols(chunkId: string): SymbolReference[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT id, chunk_id, name, kind FROM symbol_references WHERE chunk_id = ?').all(chunkId) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: String(r.id),
      chunkId: String(r.chunk_id),
      name: String(r.name),
      kind: r.kind as any,
    }));
  }

  getChunkRelationships(chunkId: string): ChunkRelationship[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare(`
      SELECT source_chunk_id, target_chunk_id, type
      FROM chunk_relationships
      WHERE source_chunk_id = ? OR target_chunk_id = ?
    `).all(chunkId, chunkId) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      sourceChunkId: String(r.source_chunk_id),
      targetChunkId: String(r.target_chunk_id),
      type: r.type as any,
    }));
  }

  countChunks(snapshotId?: string): number {
    const raw = this.db.getRawDb();
    if (snapshotId) {
      const row = raw.prepare('SELECT COUNT(*) as count FROM chunks WHERE snapshot_id = ?').get(snapshotId) as { count: number };
      return row?.count || 0;
    }
    const row = raw.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    return row?.count || 0;
  }

  searchChunksFts(
    query: string,
    options: { limit?: number; snapshotId?: string; chunkType?: ChunkType; docVersion?: string } = {}
  ): Array<{ chunk: DocumentChunk; ftsRank: number; symbols: SymbolReference[]; codeSnippets: ChunkCode[] }> {
    if (!this.db.isFtsAvailable()) {
      return [];
    }

    const raw = this.db.getRawDb();
    const limit = options.limit || 20;

    // Sanitize query for FTS5: strip dangerous punctuation, quote bare words or phrases
    const cleanTokens = query
      .replace(/[^\w\s-]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0);

    if (cleanTokens.length === 0) {
      return [];
    }

    // Use OR-joined quoted tokens or phrase search
    const sanitizedFtsQuery = cleanTokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');

    try {
      let sql = `
        SELECT c.*, fts.rank as fts_rank
        FROM chunks c
        JOIN chunks_fts fts ON c.id = fts.chunk_id
        WHERE chunks_fts MATCH ?
      `;
      const params: unknown[] = [sanitizedFtsQuery];

      if (options.snapshotId) {
        sql += ' AND c.snapshot_id = ?';
        params.push(options.snapshotId);
      }

      if (options.chunkType) {
        sql += ' AND c.chunk_type = ?';
        params.push(options.chunkType);
      }

      if (options.docVersion) {
        sql += ' AND c.doc_version = ?';
        params.push(options.docVersion);
      }

      sql += ' ORDER BY fts.rank LIMIT ?';
      params.push(limit);

      const rows = raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;

      return rows.map(r => {
        const chunk = this.hydrateChunk(r);
        return {
          chunk,
          ftsRank: Number(r.fts_rank),
          symbols: this.getChunkSymbols(chunk.id),
          codeSnippets: this.getChunkCode(chunk.id),
        };
      });
    } catch {
      return [];
    }
  }

  private hydrateChunk(row: Record<string, unknown>): DocumentChunk {
    const sectionPath: string[] = row.section_path_json ? JSON.parse(String(row.section_path_json)) : [];
    const provenance: Provenance = row.provenance_json
      ? JSON.parse(String(row.provenance_json))
      : {
          sourceUrl: '',
          targetUrl: '',
          fetchedAt: String(row.created_at || ''),
          discoveredBy: 'direct',
          contentHash: String(row.content_hash || ''),
          snapshotId: String(row.snapshot_id || ''),
        };

    return {
      id: String(row.id),
      pageId: String(row.page_id),
      snapshotId: String(row.snapshot_id),
      title: row.title ? String(row.title) : undefined,
      sectionPath,
      content: String(row.content),
      chunkType: row.chunk_type as ChunkType,
      language: row.language ? String(row.language) : undefined,
      tokenEstimate: Number(row.token_estimate),
      ordinal: Number(row.ordinal),
      contentHash: String(row.content_hash),
      docVersion: row.doc_version ? String(row.doc_version) : undefined,
      provenance,
    };
  }
}
