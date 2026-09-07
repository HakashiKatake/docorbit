import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { SCHEMA_SQL, FTS_SCHEMA_SQL } from './schema.ts';

export class DocOrbitDb {
  private db: DatabaseSync;
  private ftsAvailable = false;

  constructor(dbPath: string = ':memory:') {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);

    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON;');

    // Enable WAL mode for file-based database for concurrent reads
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }

    this.migrate();
  }

  private migrate(): void {
    // Base relational tables
    this.db.exec(SCHEMA_SQL);

    // Schema evolution migrations
    try {
      this.db.exec('ALTER TABLE pages ADD COLUMN provenance_json TEXT;');
    } catch {
      // Column already exists
    }

    try {
      this.db.exec('ALTER TABLE snapshots ADD COLUMN doc_version TEXT;');
    } catch {
      // Column already exists
    }

    try {
      this.db.exec('ALTER TABLE chunks ADD COLUMN doc_version TEXT;');
    } catch {
      // Column already exists
    }

    // Test and enable FTS5 virtual table
    try {
      this.db.exec(FTS_SCHEMA_SQL);
      this.ftsAvailable = true;
    } catch {
      this.ftsAvailable = false;
    }
  }

  isFtsAvailable(): boolean {
    return this.ftsAvailable;
  }

  getRawDb(): DatabaseSync {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

