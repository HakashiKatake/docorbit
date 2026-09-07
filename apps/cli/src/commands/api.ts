import { DocOrbitDb, DocOrbitRepository } from '../../../../packages/storage/src/index.ts';
import { resolveProjectContext } from '../../../../packages/workspace/src/index.ts';
import type { ApiCommandOptions } from '../../../../packages/shared/src/index.ts';
import { formatApiEndpoints } from '../formatters/terminal.ts';

export async function runApiCommand(query: string = '', options: ApiCommandOptions = {}): Promise<void> {
  const dbPath = options.dbPath || '.docorbit/docorbit.db';
  const db = new DocOrbitDb(dbPath);
  const repository = new DocOrbitRepository(db);

  try {
    let effectiveDocVersion = options.docVersion;

    if (options.projectDir) {
      const projContext = resolveProjectContext(options.projectDir, query, repository);
      if (projContext.matchedDependency && !effectiveDocVersion) {
        effectiveDocVersion = projContext.matchedDependency.targetDocVersion;
      }
    }

    const endpoints = repository.searchApiEndpoints(query, {
      method: options.method,
      docVersion: effectiveDocVersion,
      limit: options.limit || 20,
    });

    if (options.json) {
      console.log(JSON.stringify(endpoints, null, 2));
    } else {
      console.log(formatApiEndpoints(endpoints, query));
    }
  } catch (err: unknown) {
    console.error(`DocOrbit API Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
