import { DocOrbitDb, DocOrbitRepository, resolveDefaultDbPath } from '../../../../packages/storage/src/index.ts';
import { ImpactAnalysisService } from '../../../../packages/verification/src/index.ts';
import type { ImpactCommandOptions } from '../../../../packages/shared/src/index.ts';
import { formatImpactReport } from '../formatters/terminal.ts';

export async function runImpactCommand(target: string = '', options: ImpactCommandOptions = {}): Promise<void> {
  const dbPath = resolveDefaultDbPath(options.dbPath, options.projectDir, options.global);
  const db = new DocOrbitDb(dbPath);
  const repo = new DocOrbitRepository(db);

  try {
    const service = new ImpactAnalysisService(repo);
    const { result } = service.analyzeImpact({
      projectDir: options.projectDir || process.cwd(),
      fromVersion: options.from,
      toVersion: options.to,
      sourceId: options.source || (target && !target.startsWith('-') ? target : undefined),
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatImpactReport(result));
    }
  } catch (err: unknown) {
    console.error(`DocOrbit Impact Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
