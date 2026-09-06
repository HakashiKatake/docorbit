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

CREATE INDEX IF NOT EXISTS idx_pages_source_id ON pages(source_id);
CREATE INDEX IF NOT EXISTS idx_pages_content_hash ON pages(content_hash);
CREATE INDEX IF NOT EXISTS idx_links_page_id ON links(page_id);
CREATE INDEX IF NOT EXISTS idx_code_examples_page_id ON code_examples(page_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_source_id ON snapshots(source_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_pages_snapshot_id ON snapshot_pages(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_pages_page_id ON snapshot_pages(page_id);
`;

export const FTS_SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  page_id UNINDEXED,
  title,
  content
);
`;
