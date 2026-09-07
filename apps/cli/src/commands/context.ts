import { DocOrbitDb, DocOrbitRepository, resolveDefaultDbPath } from '../../../../packages/storage/src/index.ts';
import { RetrievalEngine } from '../../../../packages/retrieval/src/index.ts';
import { formatContextPackage } from '../formatters/terminal.ts';

export interface ContextCommandOptions {
  json?: boolean;
  dbPath?: string;
  tokens?: number;
  maxChunks?: number;
  snapshotId?: string;
  docVersion?: string;
  projectDir?: string;
}

export async function runContextCommand(task: string, options: ContextCommandOptions = {}): Promise<void> {
  if (!task) {
    console.error('Error: Please provide a coding task description.');
    console.error('Usage: docorbit context "<task>" [--tokens <n>] [--doc-version <ver>] [--project <dir>] [--json] [--db <path>]');
    process.exit(1);
  }

  const dbPath = resolveDefaultDbPath(options.dbPath, options.projectDir);
  const db = new DocOrbitDb(dbPath);
  const repository = new DocOrbitRepository(db);
  const engine = new RetrievalEngine(repository);

  try {
    const pkg = await engine.buildContext(task, {
      tokenBudget: options.tokens || 3000,
      maxChunks: options.maxChunks,
      snapshotId: options.snapshotId,
      docVersion: options.docVersion,
      projectDir: options.projectDir,
    });

    if (options.json) {
      console.log(JSON.stringify(pkg, null, 2));
    } else {
      console.log(formatContextPackage(pkg));
    }
  } catch (err: unknown) {
    console.error(`DocOrbit Context Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
