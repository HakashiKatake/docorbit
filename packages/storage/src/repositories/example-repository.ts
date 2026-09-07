import type { IndexedExample } from '../../../shared/src/index.ts';
import type { DocOrbitDb } from '../db.ts';
import type { IExampleRepository } from '../interfaces.ts';
import { extractSearchTokens } from '../search-tokens.ts';

export class ExampleRepository implements IExampleRepository {
  private db: DocOrbitDb;

  constructor(db: DocOrbitDb) {
    this.db = db;
  }

  saveIndexedExamples(examples: IndexedExample[]): void {
    if (examples.length === 0) return;
    const raw = this.db.getRawDb();

    const insertEx = raw.prepare(`
      INSERT INTO indexed_examples (
        id, chunk_id, page_id, snapshot_id, language, framework,
        task, code, source_url, source_authority, related_api,
        related_symbol, doc_version, provenance_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        chunk_id = excluded.chunk_id,
        language = excluded.language,
        framework = excluded.framework,
        task = excluded.task,
        code = excluded.code,
        source_url = excluded.source_url,
        source_authority = excluded.source_authority,
        related_api = excluded.related_api,
        related_symbol = excluded.related_symbol,
        doc_version = excluded.doc_version,
        provenance_json = excluded.provenance_json
    `);

    const insertFts = this.db.isFtsAvailable()
      ? raw.prepare(`
          INSERT INTO indexed_examples_fts (example_id, task, language, framework, code, related_api, related_symbol)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
      : null;

    const deleteFts = this.db.isFtsAvailable()
      ? raw.prepare('DELETE FROM indexed_examples_fts WHERE example_id = ?')
      : null;

    raw.exec('BEGIN TRANSACTION;');
    try {
      for (const ex of examples) {
        insertEx.run(
          ex.id,
          ex.chunkId || null,
          ex.pageId,
          ex.snapshotId || 'snap_default',
          ex.language,
          ex.framework || null,
          ex.task,
          ex.code,
          ex.sourceUrl,
          ex.sourceAuthority,
          ex.relatedApi || null,
          ex.relatedSymbol || null,
          ex.docVersion || null,
          ex.provenance ? JSON.stringify(ex.provenance) : null,
          ex.createdAt || new Date().toISOString()
        );

        if (insertFts && deleteFts) {
          deleteFts.run(ex.id);
          insertFts.run(
            ex.id,
            ex.task,
            ex.language,
            ex.framework || '',
            ex.code,
            ex.relatedApi || '',
            ex.relatedSymbol || ''
          );
        }
      }
      raw.exec('COMMIT;');
    } catch (err) {
      raw.exec('ROLLBACK;');
      throw err;
    }
  }

  getIndexedExamplesBySnapshot(snapshotId: string): IndexedExample[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT * FROM indexed_examples WHERE snapshot_id = ?').all(snapshotId) as Array<Record<string, unknown>>;
    return rows.map(r => this.hydrateIndexedExample(r));
  }

  searchIndexedExamples(
    query: string,
    options: { language?: string; framework?: string; docVersion?: string; limit?: number } = {}
  ): IndexedExample[] {
    const raw = this.db.getRawDb();
    const limit = options.limit || 10;
    const term = query.trim();

    let results: IndexedExample[] = [];

    // FTS attempt
    if (this.db.isFtsAvailable() && term.length > 0) {
      const cleanTokens = extractSearchTokens(term);

      if (cleanTokens.length > 0) {
        const sanitizedFts = cleanTokens
          .map(t => t.length >= 4 ? `"${t.replace(/"/g, '""')}"*` : `"${t.replace(/"/g, '""')}"`)
          .join(' OR ');
        try {
          let sql = `
            SELECT ex.*, fts.rank as fts_rank
            FROM indexed_examples ex
            JOIN indexed_examples_fts fts ON ex.id = fts.example_id
            WHERE indexed_examples_fts MATCH ?
          `;
          const params: unknown[] = [sanitizedFts];

          if (options.language) {
            sql += ' AND lower(ex.language) = ?';
            params.push(options.language.toLowerCase());
          }
          if (options.framework) {
            sql += ' AND lower(ex.framework) = ?';
            params.push(options.framework.toLowerCase());
          }
          if (options.docVersion) {
            sql += ' AND (ex.doc_version = ? OR ex.doc_version IS NULL)';
            params.push(options.docVersion);
          }

          sql += " ORDER BY CASE WHEN ex.source_authority = 'official' THEN 0 ELSE 1 END, fts.rank LIMIT ?";
          params.push(limit);

          const rows = raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;
          results = rows.map(r => this.hydrateIndexedExample(r));
        } catch {
          // Fall through to LIKE
        }
      }
    }

    if (results.length === 0) {
      // LIKE fallback
      let sql = 'SELECT * FROM indexed_examples WHERE 1=1';
      const params: unknown[] = [];

      if (options.language) {
        sql += ' AND lower(language) = ?';
        params.push(options.language.toLowerCase());
      }
      if (options.framework) {
        sql += ' AND lower(framework) = ?';
        params.push(options.framework.toLowerCase());
      }
      if (options.docVersion) {
        sql += ' AND (doc_version = ? OR doc_version IS NULL)';
        params.push(options.docVersion);
      }
      if (term.length > 0) {
        const tokens = extractSearchTokens(term);
        if (tokens.length > 0) {
          const tokenClauses = tokens.map(() => '(task LIKE ? OR code LIKE ? OR related_api LIKE ? OR related_symbol LIKE ?)');
          sql += ` AND (${tokenClauses.join(' OR ')})`;
          for (const t of tokens) {
            const lp = `%${t}%`;
            params.push(lp, lp, lp, lp);
          }
        } else {
          return [];
        }
      }

      sql += " ORDER BY CASE WHEN source_authority = 'official' THEN 0 ELSE 1 END LIMIT ?";
      params.push(limit);

      const rows = raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      results = rows.map(r => this.hydrateIndexedExample(r));
    }

    return results;
  }

  private hydrateIndexedExample(row: Record<string, unknown>): IndexedExample {
    return {
      id: String(row.id),
      chunkId: row.chunk_id ? String(row.chunk_id) : undefined,
      pageId: String(row.page_id),
      snapshotId: String(row.snapshot_id),
      language: String(row.language),
      framework: row.framework ? String(row.framework) : undefined,
      task: String(row.task),
      code: String(row.code),
      sourceUrl: String(row.source_url),
      sourceAuthority: String(row.source_authority) as IndexedExample['sourceAuthority'],
      relatedApi: row.related_api ? String(row.related_api) : undefined,
      relatedSymbol: row.related_symbol ? String(row.related_symbol) : undefined,
      docVersion: row.doc_version ? String(row.doc_version) : undefined,
      provenance: row.provenance_json ? JSON.parse(String(row.provenance_json)) : undefined,
      createdAt: String(row.created_at),
    };
  }
}
