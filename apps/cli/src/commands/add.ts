import { DocOrbitDb, DocOrbitRepository, resolveDefaultDbPath } from '../../../../packages/storage/src/index.ts';
import { IngestionPipeline } from '../../../../packages/core/src/index.ts';
import { formatIngestionResult } from '../formatters/terminal.ts';

export interface AddCommandOptions {
  json?: boolean;
  dbPath?: string;
  maxPages?: number;
  allowLocalhost?: boolean;
  projectDir?: string;
}

export async function runAddCommand(targetUrl: string, options: AddCommandOptions = {}): Promise<void> {
  if (!targetUrl) {
    console.error('Error: Please provide a documentation target URL.');
    console.error('Usage: docorbit add <url> [--json] [--db <path>] [--project <dir>]');
    process.exit(1);
  }

  const dbPath = resolveDefaultDbPath(options.dbPath, options.projectDir);
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
  } catch (err: unknown) {
    console.error(`DocOrbit Ingestion Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
