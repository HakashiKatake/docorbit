import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir as getHomedir, tmpdir as getTmpdir } from 'node:os';
import { SCHEMA_SQL, FTS_SCHEMA_SQL } from './schema.ts';

const PROJECT_MARKERS = [
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'pom.xml',
  'build.gradle',
  '.git',
  '.docorbit',
];

export function findNearestProjectRoot(startDir: string): string | null {
  try {
    let current = resolve(startDir);
    const userHome = process.env.HOME || process.env.USERPROFILE || getHomedir();
    while (current && current !== '/' && current !== dirname(current)) {
      if (userHome && current === userHome) {
        break; // Don't treat user home directory as a project root
      }
      for (const marker of PROJECT_MARKERS) {
        if (existsSync(join(current, marker))) {
          return current;
        }
      }
      current = dirname(current);
    }
  } catch {}
  return null;
}

export function resolveGlobalDbPath(): string {
  const userHome = process.env.HOME || process.env.USERPROFILE || getHomedir();
  if (userHome) {
    return join(userHome, '.docorbit', 'docorbit.db');
  }
  return join(getTmpdir(), '.docorbit', 'docorbit.db');
}

export function hasProjectDb(projectDir: string = '.'): boolean {
  try {
    const resolved = resolve(projectDir);
    const root = findNearestProjectRoot(resolved) || resolved;
    return existsSync(join(root, '.docorbit', 'docorbit.db'));
  } catch {}
  return false;
}

export function resolveDefaultDbPath(explicitDbPath?: string, projectDir?: string, isGlobal?: boolean): string {
  if (explicitDbPath && explicitDbPath !== ':memory:') {
    return explicitDbPath;
  }
  if (explicitDbPath === ':memory:') {
    return ':memory:';
  }

  // 1. Explicitly requested global store (-g / --global)
  if (isGlobal) {
    return resolveGlobalDbPath();
  }

  const globalPath = resolveGlobalDbPath();

  // 2. If projectDir is provided, check project root .docorbit/
  if (projectDir) {
    const resolvedProjectDir = resolve(projectDir);
    const userHome = process.env.HOME || process.env.USERPROFILE || getHomedir();
    if (resolvedProjectDir !== '/' && resolvedProjectDir !== userHome) {
      const root = findNearestProjectRoot(resolvedProjectDir) || resolvedProjectDir;
      const projDb = join(root, '.docorbit', 'docorbit.db');
      if (existsSync(projDb) || !existsSync(globalPath)) {
        return projDb;
      }
      return globalPath;
    }
  }

  // 3. Detect project root from current working directory
  try {
    const cwd = process.cwd();
    const userHome = process.env.HOME || process.env.USERPROFILE || getHomedir();
    if (cwd && cwd !== '/' && cwd !== userHome) {
      const root = findNearestProjectRoot(cwd) || cwd;
      const projDb = join(root, '.docorbit', 'docorbit.db');
      if (existsSync(projDb) || !existsSync(globalPath)) {
        return projDb;
      }
      return globalPath;
    }
  } catch {}

  // 4. Fallback to global user store: ~/.docorbit/docorbit.db
  return globalPath;
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

    // High-performance SQLite engine tuning for sub-millisecond retrieval
    try {
      this.db.exec('PRAGMA synchronous = NORMAL;');
      this.db.exec('PRAGMA cache_size = -64000;'); // 64MB memory page cache
      this.db.exec('PRAGMA temp_store = MEMORY;');
      this.db.exec('PRAGMA busy_timeout = 5000;');
    } catch {
      // Ignore if pragma unsupported
    }

    // Enable WAL mode and memory-mapped zero-copy I/O for file-based database
    if (targetPath !== ':memory:') {
      try {
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA mmap_size = 268435456;'); // 256MB mmap
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

    const newPageColumns = [
      'page_type TEXT',
      'parent_url TEXT',
      'category TEXT',
      'breadcrumb_json TEXT',
      'depth INTEGER',
      'discovery_method TEXT',
    ];
    for (const col of newPageColumns) {
      try {
        this.db.exec(`ALTER TABLE pages ADD COLUMN ${col};`);
      } catch {
        // Column already exists
      }
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

  private statementCache = new Map<string, StatementSync>();

  prepareStatement(sql: string): StatementSync {
    let stmt = this.statementCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.statementCache.set(sql, stmt);
    }
    return stmt;
  }

  getRawDb(): DatabaseSync {
    return this.db;
  }

  close(): void {
    this.statementCache.clear();
    this.db.close();
  }
}

