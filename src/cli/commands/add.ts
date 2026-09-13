import { DocOrbitDb, DocOrbitRepository, resolveDefaultDbPath, hasProjectDb } from '../../storage/index.ts';
import { SourceManagementService, type IngestionResult } from '../../core/index.ts';
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
  force?: boolean;
  refresh?: boolean;
  trackOnly?: boolean;
}

export async function runAddCommand(targetUrl: string, options: AddCommandOptions = {}): Promise<void> {
  if (!targetUrl) {
    console.error('Error: Please provide a documentation target URL.');
    console.error('Usage: docorbit add <url> [-p | -g] [--force] [--json] [--db <path>] [--project <dir>]');
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
    const sourceManager = new SourceManagementService(repository, {
      projectDir: options.projectDir,
    });

    const result = await sourceManager.addOrTrackSource({
      url: targetUrl,
      projectDir: options.projectDir,
      force: options.force,
      refresh: options.refresh,
      trackOnly: options.trackOnly,
      maxPages: options.maxPages || 50,
      allowLocalhost: options.allowLocalhost,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.status === 'already_tracked') {
      console.log(`\nDocOrbit — Source Already Tracked`);
      console.log(`════════════════════════════════════════════════════════════════`);
      console.log(`Canonical URL: ${result.url}`);
      console.log(`Source ID:     ${result.sourceId}`);
      if (result.snapshotId) {
        console.log(`Snapshot ID:   ${result.snapshotId}`);
        console.log(`Snapshot Hash: ${result.snapshotHash}`);
        console.log(`Pages Cached:  ${result.pageCount ?? 'N/A'}`);
      }
      console.log(`Tracked At:    ${result.trackedAt}`);
      console.log(`Last Checked:  ${result.updatedAt}`);
      console.log(`────────────────────────────────────────────────────────────────`);
      console.log(`Status: Source is already tracked and up-to-date in docs.lock.`);
      console.log(`Tip: Use --force or --refresh to re-fetch and check for documentation updates.\n`);
      return;
    }

    if (result.ingestionResult) {
      console.log(formatIngestionResult(result.ingestionResult as IngestionResult));
    }

    if (result.status === 'updated') {
      console.log(`\nUpdated tracked source in docs.lock: ${result.url}`);
    } else {
      console.log(`\nTracked source in docs.lock: ${result.url}`);
    }
  } catch (err: unknown) {
    console.error(`DocOrbit Ingestion Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
