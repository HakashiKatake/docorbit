import { DocOrbitDb, DocOrbitRepository, resolveDefaultDbPath } from '../../../../packages/storage/src/index.ts';
import { RetrievalEngine } from '../../../../packages/retrieval/src/index.ts';
import type { ChunkType } from '../../../../packages/shared/src/index.ts';
import { formatSearchResults } from '../formatters/terminal.ts';

export interface SearchCommandOptions {
  json?: boolean;
  dbPath?: string;
  limit?: number;
  chunkType?: ChunkType;
  snapshotId?: string;
  docVersion?: string;
  projectDir?: string;
  global?: boolean;
  project?: boolean;
}

export async function runSearchCommand(query: string, options: SearchCommandOptions = {}): Promise<void> {
  if (!query) {
    console.error('Error: Please provide a search query.');
    console.error('Usage: docorbit search "<query>" [-p | -g] [--limit <n>] [--type <type>] [--doc-version <ver>] [--project <dir>] [--json] [--db <path>]');
    process.exit(1);
  }

  const dbPath = resolveDefaultDbPath(options.dbPath, options.projectDir, options.global);
  const db = new DocOrbitDb(dbPath);
  const repository = new DocOrbitRepository(db);
  const engine = new RetrievalEngine(repository);

  try {
    const results = await engine.search(query, {
      limit: options.limit || 10,
      chunkType: options.chunkType,
      snapshotId: options.snapshotId,
      docVersion: options.docVersion,
      projectDir: options.projectDir,
    });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(formatSearchResults(query, results));
    }
  } catch (err: unknown) {
    console.error(`DocOrbit Search Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
