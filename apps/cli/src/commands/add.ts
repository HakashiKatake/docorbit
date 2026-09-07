import { DocOrbitDb, DocOrbitRepository, resolveDefaultDbPath, hasProjectDb } from '../../../../packages/storage/src/index.ts';
import { IngestionPipeline } from '../../../../packages/core/src/index.ts';
import {
  detectWorkspaceDependencies,
  generateDocsLock,
  readDocsLock,
  writeDocsLock,
} from '../../../../packages/workspace/src/index.ts';
import { formatIngestionResult } from '../formatters/terminal.ts';
import { promptStorageLocation } from '../prompts.ts';

export interface AddCommandOptions {
  json?: boolean;
  dbPath?: string;
  maxPages?: number;
  allowLocalhost?: boolean;
  projectDir?: string;
  global?: boolean;
  project?: boolean;
}

export async function runAddCommand(targetUrl: string, options: AddCommandOptions = {}): Promise<void> {
  if (!targetUrl) {
    console.error('Error: Please provide a documentation target URL.');
    console.error('Usage: docorbit add <url> [-p | -g] [--json] [--db <path>] [--project <dir>]');
    process.exit(1);
  }

  let isGlobal = options.global;
  if (
    !isGlobal &&
    !options.project &&
    !options.dbPath &&
    !options.json &&
    process.stdin.isTTY &&
    !hasProjectDb(options.projectDir || '.')
  ) {
    const choice = await promptStorageLocation(options.projectDir);
    isGlobal = choice === 'global';
  }

  const dbPath = resolveDefaultDbPath(options.dbPath, options.projectDir, isGlobal);
  const db = new DocOrbitDb(dbPath);
  const repository = new DocOrbitRepository(db);

  try {
    const pipeline = new IngestionPipeline(repository, {
      allowLocalhostForTesting: options.allowLocalhost,
      crawlerConfig: {
        maxPages: options.maxPages || 50,
      },
    });

    const result = await pipeline.ingest(targetUrl);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatIngestionResult(result));
    }

    // Automatically update docs.lock if in a project directory with dependencies
    try {
      const targetDir = options.projectDir || '.';
      const scanResult = detectWorkspaceDependencies(targetDir);
      if (scanResult.dependencies.length > 0) {
        const existingLock = readDocsLock(targetDir);
        const lock = generateDocsLock(scanResult, repository, existingLock);
        const lockedCount = Object.keys(lock.dependencies).length;
        if (lockedCount > 0) {
          writeDocsLock(targetDir, lock);
          if (!options.json) {
            console.log(`\nUpdated docs.lock: ${lockedCount} project dependencies resolved to documentation.`);
          }
        }
      }
    } catch {
      // Non-critical: do not fail add command if lockfile update encounters issues
    }
  } catch (err: unknown) {
    console.error(`DocOrbit Ingestion Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
