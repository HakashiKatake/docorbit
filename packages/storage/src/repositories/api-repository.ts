import type { ApiEndpoint } from '../../../shared/src/index.ts';
import type { DocOrbitDb } from '../db.ts';
import type { IApiRepository } from '../interfaces.ts';
import { extractSearchTokens } from '../search-tokens.ts';

export class ApiRepository implements IApiRepository {
  private db: DocOrbitDb;

  constructor(db: DocOrbitDb) {
    this.db = db;
  }

  saveApiEndpoints(endpoints: ApiEndpoint[]): void {
    if (endpoints.length === 0) return;
    const raw = this.db.getRawDb();

    const insertEp = raw.prepare(`
      INSERT INTO api_endpoints (
        id, page_id, snapshot_id, method, path, summary, description,
        operation_id, parameters_json, request_schema_json, response_schema_json,
        auth_json, errors_json, pagination_json, deprecated, doc_version,
        provenance_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        method = excluded.method,
        path = excluded.path,
        summary = excluded.summary,
        description = excluded.description,
        operation_id = excluded.operation_id,
        parameters_json = excluded.parameters_json,
        request_schema_json = excluded.request_schema_json,
        response_schema_json = excluded.response_schema_json,
        auth_json = excluded.auth_json,
        errors_json = excluded.errors_json,
        pagination_json = excluded.pagination_json,
        deprecated = excluded.deprecated,
        doc_version = excluded.doc_version,
        provenance_json = excluded.provenance_json
    `);

    const insertFts = this.db.isFtsAvailable()
      ? raw.prepare(`
          INSERT INTO api_endpoints_fts (endpoint_id, method, path, summary, description, parameters)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
      : null;

    const deleteFts = this.db.isFtsAvailable()
      ? raw.prepare('DELETE FROM api_endpoints_fts WHERE endpoint_id = ?')
      : null;

    raw.exec('BEGIN TRANSACTION;');
    try {
      for (const ep of endpoints) {
        insertEp.run(
          ep.id,
          ep.pageId,
          ep.snapshotId || 'snap_default',
          ep.method,
          ep.path,
          ep.summary || null,
          ep.description || null,
          ep.operationId || null,
          JSON.stringify(ep.parameters || []),
          ep.requestSchema ? JSON.stringify(ep.requestSchema) : null,
          ep.responseSchema ? JSON.stringify(ep.responseSchema) : null,
          ep.auth ? JSON.stringify(ep.auth) : '[]',
          ep.errors ? JSON.stringify(ep.errors) : '[]',
          ep.pagination ? JSON.stringify(ep.pagination) : null,
          ep.deprecated ? 1 : 0,
          ep.docVersion || null,
          ep.provenance ? JSON.stringify(ep.provenance) : null,
          ep.createdAt || new Date().toISOString()
        );

        if (insertFts && deleteFts) {
          deleteFts.run(ep.id);
          const paramNames = (ep.parameters || []).map(p => p.name).join(' ');
          insertFts.run(
            ep.id,
            ep.method,
            ep.path,
            ep.summary || '',
            ep.description || '',
            paramNames
          );
        }
      }
      raw.exec('COMMIT;');
    } catch (err) {
      raw.exec('ROLLBACK;');
      throw err;
    }
  }

  getApiEndpoint(id: string): ApiEndpoint | null {
    const raw = this.db.getRawDb();
    const row = raw.prepare('SELECT * FROM api_endpoints WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrateApiEndpoint(row) : null;
  }

  getApiEndpointsBySnapshot(snapshotId: string): ApiEndpoint[] {
    const raw = this.db.getRawDb();
    const rows = raw.prepare('SELECT * FROM api_endpoints WHERE snapshot_id = ? ORDER BY path, method').all(snapshotId) as Array<Record<string, unknown>>;
    return rows.map(r => this.hydrateApiEndpoint(r));
  }

  searchApiEndpoints(
    query: string,
    options: { method?: string; docVersion?: string; limit?: number } = {}
  ): ApiEndpoint[] {
    const raw = this.db.getRawDb();
    const limit = options.limit || 20;
    const cleanQuery = query.trim();

    // Check if query specifies method at start (e.g. "POST /v1/...")
    let effectiveMethod = options.method?.toLowerCase();
    let term = cleanQuery;
    const methodMatch = cleanQuery.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(.*)$/i);
    if (methodMatch) {
      effectiveMethod = methodMatch[1].toLowerCase();
      term = methodMatch[2].trim();
    }

    // Try FTS if available and term exists
    if (this.db.isFtsAvailable() && term.length > 0) {
      const cleanTokens = extractSearchTokens(term);

      if (cleanTokens.length > 0) {
        const sanitizedFts = cleanTokens
          .map(t => t.length >= 4 ? `"${t.replace(/"/g, '""')}"*` : `"${t.replace(/"/g, '""')}"`)
          .join(' OR ');
        try {
          let sql = `
            SELECT ep.*, fts.rank as fts_rank
            FROM api_endpoints ep
            JOIN api_endpoints_fts fts ON ep.id = fts.endpoint_id
            WHERE api_endpoints_fts MATCH ?
          `;
          const params: unknown[] = [sanitizedFts];

          if (effectiveMethod) {
            sql += ' AND lower(ep.method) = ?';
            params.push(effectiveMethod);
          }
          if (options.docVersion) {
            sql += ' AND (ep.doc_version = ? OR ep.doc_version IS NULL)';
            params.push(options.docVersion);
          }

          sql += ' ORDER BY fts.rank LIMIT ?';
          params.push(limit);

          const rows = raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;
          if (rows.length > 0) {
            return rows.map(r => this.hydrateApiEndpoint(r));
          }
        } catch {
          // Fall through to LIKE search
        }
      }
    }

    // LIKE fallback search
    let sql = 'SELECT * FROM api_endpoints WHERE 1=1';
    const params: unknown[] = [];

    if (effectiveMethod) {
      sql += ' AND lower(method) = ?';
      params.push(effectiveMethod);
    }
    if (options.docVersion) {
      sql += ' AND (doc_version = ? OR doc_version IS NULL)';
      params.push(options.docVersion);
    }
    if (term.length > 0) {
      const tokens = extractSearchTokens(term);
      if (tokens.length > 0) {
        const tokenClauses = tokens.map(() => '(path LIKE ? OR summary LIKE ? OR description LIKE ? OR parameters_json LIKE ?)');
        sql += ` AND (${tokenClauses.join(' OR ')})`;
        for (const t of tokens) {
          const lp = `%${t}%`;
          params.push(lp, lp, lp, lp);
        }
      } else {
        return [];
      }
    }

    sql += ' ORDER BY path, method LIMIT ?';
    params.push(limit);

    const rows = raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(r => this.hydrateApiEndpoint(r));
  }

  private hydrateApiEndpoint(row: Record<string, unknown>): ApiEndpoint {
    return {
      id: String(row.id),
      pageId: String(row.page_id),
      snapshotId: String(row.snapshot_id),
      method: String(row.method) as ApiEndpoint['method'],
      path: String(row.path),
      summary: row.summary ? String(row.summary) : undefined,
      description: row.description ? String(row.description) : undefined,
      operationId: row.operation_id ? String(row.operation_id) : undefined,
      parameters: row.parameters_json ? JSON.parse(String(row.parameters_json)) : [],
      requestSchema: row.request_schema_json ? JSON.parse(String(row.request_schema_json)) : undefined,
      responseSchema: row.response_schema_json ? JSON.parse(String(row.response_schema_json)) : undefined,
      auth: row.auth_json ? JSON.parse(String(row.auth_json)) : [],
      errors: row.errors_json ? JSON.parse(String(row.errors_json)) : [],
      pagination: row.pagination_json ? JSON.parse(String(row.pagination_json)) : undefined,
      deprecated: Number(row.deprecated) === 1,
      docVersion: row.doc_version ? String(row.doc_version) : undefined,
      provenance: row.provenance_json ? JSON.parse(String(row.provenance_json)) : undefined,
      createdAt: String(row.created_at),
    };
  }
}
