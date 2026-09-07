export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  discovered_by TEXT NOT NULL,
  status TEXT NOT NULL,
  content_type TEXT,
  confidence REAL NOT NULL,
  authority TEXT NOT NULL,
  machine_readable INTEGER NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  raw_bytes INTEGER NOT NULL,
  estimated_tokens INTEGER NOT NULL,
  headings_json TEXT,
  security_annotations_json TEXT,
  provenance_json TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  text TEXT NOT NULL,
  url TEXT NOT NULL,
  is_external INTEGER NOT NULL,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS code_examples (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  language TEXT NOT NULL,
  code TEXT NOT NULL,
  caption TEXT,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  doc_version TEXT,
  metadata TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_pages (
  snapshot_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, page_id),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  title TEXT,
  section_path_json TEXT NOT NULL,
  content TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  language TEXT,
  token_estimate INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  doc_version TEXT,
  provenance_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chunk_code (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL,
  language TEXT,
  code TEXT NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS symbol_references (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chunk_relationships (
  source_chunk_id TEXT NOT NULL,
  target_chunk_id TEXT NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY (source_chunk_id, target_chunk_id, type)
);

CREATE INDEX IF NOT EXISTS idx_pages_source_id ON pages(source_id);
CREATE INDEX IF NOT EXISTS idx_pages_content_hash ON pages(content_hash);
CREATE INDEX IF NOT EXISTS idx_links_page_id ON links(page_id);
CREATE INDEX IF NOT EXISTS idx_code_examples_page_id ON code_examples(page_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_source_id ON snapshots(source_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_doc_version ON snapshots(doc_version);
CREATE INDEX IF NOT EXISTS idx_snapshot_pages_snapshot_id ON snapshot_pages(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_pages_page_id ON snapshot_pages(page_id);
CREATE INDEX IF NOT EXISTS idx_chunks_page_id ON chunks(page_id);
CREATE INDEX IF NOT EXISTS idx_chunks_snapshot_id ON chunks(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_chunks_chunk_type ON chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_chunks_content_hash ON chunks(content_hash);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_version ON chunks(doc_version);
CREATE INDEX IF NOT EXISTS idx_chunk_code_chunk_id ON chunk_code(chunk_id);
CREATE INDEX IF NOT EXISTS idx_symbol_references_chunk_id ON symbol_references(chunk_id);
CREATE INDEX IF NOT EXISTS idx_symbol_references_name ON symbol_references(name);
CREATE INDEX IF NOT EXISTS idx_chunk_relationships_source ON chunk_relationships(source_chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunk_relationships_target ON chunk_relationships(target_chunk_id);

CREATE TABLE IF NOT EXISTS api_endpoints (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  operation_id TEXT,
  parameters_json TEXT NOT NULL,
  request_schema_json TEXT,
  response_schema_json TEXT,
  auth_json TEXT NOT NULL,
  errors_json TEXT NOT NULL,
  pagination_json TEXT,
  deprecated INTEGER NOT NULL,
  doc_version TEXT,
  provenance_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_endpoints_page_id ON api_endpoints(page_id);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_snapshot_id ON api_endpoints(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_method ON api_endpoints(method);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_path ON api_endpoints(path);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_doc_version ON api_endpoints(doc_version);

CREATE TABLE IF NOT EXISTS indexed_examples (
  id TEXT PRIMARY KEY,
  chunk_id TEXT,
  page_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  language TEXT NOT NULL,
  framework TEXT,
  task TEXT NOT NULL,
  code TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_authority TEXT NOT NULL,
  related_api TEXT,
  related_symbol TEXT,
  doc_version TEXT,
  provenance_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_indexed_examples_page_id ON indexed_examples(page_id);
CREATE INDEX IF NOT EXISTS idx_indexed_examples_snapshot_id ON indexed_examples(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_indexed_examples_chunk_id ON indexed_examples(chunk_id);
CREATE INDEX IF NOT EXISTS idx_indexed_examples_language ON indexed_examples(language);
CREATE INDEX IF NOT EXISTS idx_indexed_examples_framework ON indexed_examples(framework);
CREATE INDEX IF NOT EXISTS idx_indexed_examples_doc_version ON indexed_examples(doc_version);
CREATE INDEX IF NOT EXISTS idx_indexed_examples_related_api ON indexed_examples(related_api);

CREATE TABLE IF NOT EXISTS pitfalls (
  id TEXT PRIMARY KEY,
  chunk_id TEXT,
  page_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  related_api TEXT,
  related_symbol TEXT,
  doc_version TEXT,
  provenance_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pitfalls_page_id ON pitfalls(page_id);
CREATE INDEX IF NOT EXISTS idx_pitfalls_snapshot_id ON pitfalls(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_pitfalls_chunk_id ON pitfalls(chunk_id);
CREATE INDEX IF NOT EXISTS idx_pitfalls_kind ON pitfalls(kind);
CREATE INDEX IF NOT EXISTS idx_pitfalls_doc_version ON pitfalls(doc_version);
CREATE INDEX IF NOT EXISTS idx_pitfalls_related_api ON pitfalls(related_api);
`;

export const FTS_SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  page_id UNINDEXED,
  title,
  content
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  title,
  section_path,
  content,
  symbols
);

CREATE TRIGGER IF NOT EXISTS trg_chunks_delete AFTER DELETE ON chunks BEGIN
  DELETE FROM chunks_fts WHERE chunk_id = old.id;
END;

CREATE VIRTUAL TABLE IF NOT EXISTS api_endpoints_fts USING fts5(
  endpoint_id UNINDEXED,
  method,
  path,
  summary,
  description,
  parameters
);

CREATE TRIGGER IF NOT EXISTS trg_api_endpoints_delete AFTER DELETE ON api_endpoints BEGIN
  DELETE FROM api_endpoints_fts WHERE endpoint_id = old.id;
END;

CREATE VIRTUAL TABLE IF NOT EXISTS indexed_examples_fts USING fts5(
  example_id UNINDEXED,
  task,
  language,
  framework,
  code,
  related_api,
  related_symbol
);

CREATE TRIGGER IF NOT EXISTS trg_indexed_examples_delete AFTER DELETE ON indexed_examples BEGIN
  DELETE FROM indexed_examples_fts WHERE example_id = old.id;
END;

CREATE VIRTUAL TABLE IF NOT EXISTS pitfalls_fts USING fts5(
  pitfall_id UNINDEXED,
  kind,
  title,
  content,
  related_api,
  related_symbol
);

CREATE TRIGGER IF NOT EXISTS trg_pitfalls_delete AFTER DELETE ON pitfalls BEGIN
  DELETE FROM pitfalls_fts WHERE pitfall_id = old.id;
END;
`;


