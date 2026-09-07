import { DocOrbitDb, DocOrbitRepository } from '../../../../packages/storage/src/index.ts';
import { resolveProjectContext } from '../../../../packages/workspace/src/index.ts';
import type { PitfallsCommandOptions } from '../../../../packages/shared/src/index.ts';
import { formatPitfalls } from '../formatters/terminal.ts';

export async function runPitfallsCommand(task: string = '', options: PitfallsCommandOptions = {}): Promise<void> {
  const dbPath = options.dbPath || '.docorbit/docorbit.db';
  const db = new DocOrbitDb(dbPath);
  const repository = new DocOrbitRepository(db);

  try {
    let effectiveDocVersion = options.docVersion;

    if (options.projectDir) {
      const projContext = resolveProjectContext(options.projectDir, task, repository);
      if (projContext.matchedDependency && !effectiveDocVersion) {
        effectiveDocVersion = projContext.matchedDependency.targetDocVersion;
      }
    }

    const pitfalls = repository.searchPitfalls(task, {
      kind: options.kind,
      docVersion: effectiveDocVersion,
      limit: options.limit || 10,
    });

    if (options.json) {
      console.log(JSON.stringify(pitfalls, null, 2));
    } else {
      console.log(formatPitfalls(pitfalls, task));
    }
  } catch (err: unknown) {
    console.error(`DocOrbit Pitfalls Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
