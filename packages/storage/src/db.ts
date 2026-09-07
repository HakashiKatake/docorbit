import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir as getHomedir, tmpdir as getTmpdir } from 'node:os';
import { SCHEMA_SQL, FTS_SCHEMA_SQL } from './schema.ts';

export function resolveDefaultDbPath(explicitDbPath?: string, projectDir?: string): string {
  if (explicitDbPath && explicitDbPath !== ':memory:') {
    return explicitDbPath;
  }
  if (explicitDbPath === ':memory:') {
    return ':memory:';
  }

  // 1. If projectDir has an existing .docorbit/docorbit.db, prefer it
  if (projectDir) {
    const projectDb = join(projectDir, '.docorbit', 'docorbit.db');
    if (existsSync(projectDb)) {
      return projectDb;
    }
  }

  // 2. If current working directory has .docorbit/docorbit.db, prefer it
  try {
    const cwd = process.cwd();
    if (cwd && cwd !== '/') {
      const localDb = join(cwd, '.docorbit', 'docorbit.db');
      if (existsSync(localDb)) {
        return localDb;
      }
    }
  } catch {}

  // 3. Canonical global user store: ~/.docorbit/docorbit.db
  const userHome = process.env.HOME || process.env.USERPROFILE || getHomedir();
  if (userHome) {
    return join(userHome, '.docorbit', 'docorbit.db');
  }

  return join(getTmpdir(), '.docorbit', 'docorbit.db');
}

export class DocOrbitDb {
  private db: DatabaseSync;
  private ftsAvailable = false;

  constructor(dbPath: string = ':memory:') {
    let targetPath = dbPath;

    if (dbPath !== ':memory:') {
      try {
        mkdirSync(dirname(dbPath), { recursive: true });
      } catch {
        // When running in environments where cwd is read-only (e.g. root '/' in MCP clients),
        // fallback to user home directory or system tmpdir
        const userHome = process.env.HOME || process.env.USERPROFILE || getHomedir();
        const fallbackDir = userHome ? join(userHome, '.docorbit') : join(getTmpdir(), '.docorbit');
        try {
          mkdirSync(fallbackDir, { recursive: true });
          targetPath = join(fallbackDir, 'docorbit.db');
        } catch {
          try {
            const tmpFallback = join(getTmpdir(), '.docorbit');
            mkdirSync(tmpFallback, { recursive: true });
            targetPath = join(tmpFallback, 'docorbit.db');
          } catch {
            targetPath = ':memory:';
          }
        }
      }
    }

    try {
      this.db = new DatabaseSync(targetPath);
    } catch {
      this.db = new DatabaseSync(':memory:');
      targetPath = ':memory:';
    }

    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON;');

    // Enable WAL mode for file-based database for concurrent reads
    if (targetPath !== ':memory:') {
      try {
        this.db.exec('PRAGMA journal_mode = WAL;');
      } catch {
        // Ignore if WAL pragma fails on restricted filesystems
      }
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

