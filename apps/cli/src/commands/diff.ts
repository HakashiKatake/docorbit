import { DocOrbitDb, DocOrbitRepository } from '../../../../packages/storage/src/index.ts';
import { DiffService } from '../../../../packages/verification/src/index.ts';
import type { DiffCommandOptions } from '../../../../packages/shared/src/index.ts';
import { formatDiffReport } from '../formatters/terminal.ts';

export async function runDiffCommand(target: string = '', options: DiffCommandOptions = {}): Promise<void> {
  const dbPath = options.dbPath || '.docorbit/docorbit.db';
  const db = new DocOrbitDb(dbPath);
  const repo = new DocOrbitRepository(db);

  try {
    const service = new DiffService(repo);
    const { result } = service.diffDocs({
      fromVersion: options.from,
      toVersion: options.to,
      sourceId: options.source || (target && !target.startsWith('-') ? target : undefined),
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatDiffReport(result));
    }
  } catch (err: unknown) {
    console.error(`DocOrbit Diff Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
