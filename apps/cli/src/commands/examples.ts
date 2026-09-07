import { DocOrbitDb, DocOrbitRepository, resolveDefaultDbPath } from '../../../../packages/storage/src/index.ts';
import { resolveProjectContext } from '../../../../packages/workspace/src/index.ts';
import type { ExamplesCommandOptions } from '../../../../packages/shared/src/index.ts';
import { formatIndexedExamples } from '../formatters/terminal.ts';

export async function runExamplesCommand(task: string = '', options: ExamplesCommandOptions = {}): Promise<void> {
  const dbPath = resolveDefaultDbPath(options.dbPath, options.projectDir, options.global);
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

    const examples = repository.searchIndexedExamples(task, {
      language: options.language,
      framework: options.framework,
      docVersion: effectiveDocVersion,
      limit: options.limit || 10,
    });

    if (options.json) {
      console.log(JSON.stringify(examples, null, 2));
    } else {
      console.log(formatIndexedExamples(examples, task));
    }
  } catch (err: unknown) {
    console.error(`DocOrbit Examples Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
