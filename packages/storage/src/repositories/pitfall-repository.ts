import type { Pitfall, PitfallKind } from '../../../shared/src/index.ts';
import type { DocOrbitDb } from '../db.ts';
import type { IPitfallRepository } from '../interfaces.ts';
import { extractSearchTokens } from '../search-tokens.ts';

export class PitfallRepository implements IPitfallRepository {
  private db: DocOrbitDb;

  constructor(db: DocOrbitDb) {
    this.db = db;
  }

  savePitfalls(pitfalls: Pitfall[]): void {
    if (pitfalls.length === 0) return;
    const raw = this.db.getRawDb();

    const insertPf = raw.prepare(`
      INSERT INTO pitfalls (
        id, chunk_id, page_id, snapshot_id, kind, title,
        content, related_api, related_symbol, doc_version,
        provenance_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        chunk_id = excluded.chunk_id,
        kind = excluded.kind,
        title = excluded.title,
        content = excluded.content,
        related_api = excluded.related_api,
        related_symbol = excluded.related_symbol,
        doc_version = excluded.doc_version,
        provenance_json = excluded.provenance_json
    `);

    const insertFts = this.db.isFtsAvailable()
      ? raw.prepare(`
          INSERT INTO pitfalls_fts (pitfall_id, kind, title, content, related_api, related_symbol)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
      : null;

    const deleteFts = this.db.isFtsAvailable()
      ? raw.prepare('DELETE FROM pitfalls_fts WHERE pitfall_id = ?')
      : null;

    raw.exec('BEGIN TRANSACTION;');
    try {
      for (const pf of pitfalls) {
        insertPf.run(
          pf.id,
          pf.chunkId || null,
          pf.pageId,
          pf.snapshotId || 'snap_default',
          pf.kind,
          pf.title,
          pf.content || pf.message || '',
          pf.relatedApi || null,
          pf.relatedSymbol || null,
          pf.docVersion || null,
          pf.provenance ? JSON.stringify(pf.provenance) : null,
          pf.createdAt || new Date().toISOString()
        );

        if (insertFts && deleteFts) {
          deleteFts.run(pf.id);
          insertFts.run(
            pf.id,
            pf.kind,
            pf.title,
            pf.content || pf.message || '',
            pf.relatedApi || '',
            pf.relatedSymbol || ''
          );
        }
      }
      raw.exec('COMMIT;');
    } catch (err) {
      raw.exec('ROLLBACK;');
      throw err;
    }
  }

  getPitfallsBySnapshot(snapshotId: string): Pitfall[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT * FROM pitfalls WHERE snapshot_id = ?').all(snapshotId) as Array<Record<string, unknown>>;
    return rows.map(r => this.hydratePitfall(r));
  }

  searchPitfalls(
    query: string,
    options: { kind?: PitfallKind; docVersion?: string; limit?: number } = {}
  ): Pitfall[] {
    const raw = this.db.getRawDb();
    const limit = options.limit || 10;
    const term = query.trim();

    let results: Pitfall[] = [];

    // FTS attempt
    if (this.db.isFtsAvailable() && term.length > 0) {
      const cleanTokens = extractSearchTokens(term);

      if (cleanTokens.length > 0) {
        const sanitizedFts = cleanTokens
          .map(t => t.length >= 4 ? `"${t.replace(/"/g, '""')}"*` : `"${t.replace(/"/g, '""')}"`)
          .join(' OR ');
        try {
          let sql = `
            SELECT pf.*, fts.rank as fts_rank
            FROM pitfalls pf
            JOIN pitfalls_fts fts ON pf.id = fts.pitfall_id
            WHERE pitfalls_fts MATCH ?
          `;
          const params: unknown[] = [sanitizedFts];

          if (options.kind) {
            sql += ' AND pf.kind = ?';
            params.push(options.kind);
          }
          if (options.docVersion) {
            sql += ' AND (pf.doc_version = ? OR pf.doc_version IS NULL)';
            params.push(options.docVersion);
          }

          sql += ' ORDER BY fts.rank LIMIT ?';
          params.push(limit);

          const rows = raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;
          results = rows.map(r => this.hydratePitfall(r));
        } catch {
          // Fall through to LIKE
        }
      }
    }

    if (results.length === 0) {
      // LIKE fallback
      let sql = 'SELECT * FROM pitfalls WHERE 1=1';
      const params: unknown[] = [];

      if (options.kind) {
        sql += ' AND kind = ?';
        params.push(options.kind);
      }
      if (options.docVersion) {
        sql += ' AND (doc_version = ? OR doc_version IS NULL)';
        params.push(options.docVersion);
      }
      if (term.length > 0) {
        const tokens = extractSearchTokens(term);
        if (tokens.length > 0) {
          const tokenClauses = tokens.map(() => '(title LIKE ? OR content LIKE ? OR related_api LIKE ? OR related_symbol LIKE ?)');
          sql += ` AND (${tokenClauses.join(' OR ')})`;
          for (const t of tokens) {
            const lp = `%${t}%`;
            params.push(lp, lp, lp, lp);
          }
        } else {
          return [];
        }
      }

      sql += ' ORDER BY kind LIMIT ?';
      params.push(limit);

      const rows = raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      results = rows.map(r => this.hydratePitfall(r));
    }

    return results;
  }

  private hydratePitfall(row: Record<string, unknown>): Pitfall {
    return {
      id: String(row.id),
      chunkId: row.chunk_id ? String(row.chunk_id) : undefined,
      pageId: String(row.page_id),
      snapshotId: String(row.snapshot_id),
      kind: String(row.kind) as PitfallKind,
      title: String(row.title),
      content: String(row.content),
      relatedApi: row.related_api ? String(row.related_api) : undefined,
      relatedSymbol: row.related_symbol ? String(row.related_symbol) : undefined,
      docVersion: row.doc_version ? String(row.doc_version) : undefined,
      provenance: row.provenance_json ? JSON.parse(String(row.provenance_json)) : undefined,
      createdAt: String(row.created_at),
    };
  }
}
