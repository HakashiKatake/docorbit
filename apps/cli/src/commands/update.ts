import { resolve } from 'node:path';
import { DocOrbitDb, DocOrbitRepository, resolveDefaultDbPath } from '../../../../packages/storage/src/index.ts';
import {
  detectWorkspaceDependencies,
  readDocsLock,
  updateDocsLock,
  writeDocsLock,
} from '../../../../packages/workspace/src/index.ts';
import { runInitCommand } from './init.ts';

export interface UpdateCommandOptions {
  json?: boolean;
  dbPath?: string;
  projectDir?: string;
  global?: boolean;
  project?: boolean;
}

export async function runUpdateCommand(
  targetPackage?: string,
  options: UpdateCommandOptions = {}
): Promise<void> {
  const projectDir = resolve(options.projectDir || '.');
  const existingLock = readDocsLock(projectDir);

  if (!existingLock) {
    console.log(`No docs.lock found at ${projectDir}. Initializing first...`);
    await runInitCommand(projectDir, { json: options.json, dbPath: options.dbPath, global: options.global, project: options.project });
    return;
  }

  const dbPath = resolveDefaultDbPath(options.dbPath, projectDir, options.global);
  const db = new DocOrbitDb(dbPath);
  const repository = new DocOrbitRepository(db);

  try {
    const scanResult = detectWorkspaceDependencies(projectDir);
    const updated = updateDocsLock(scanResult, repository, existingLock, targetPackage);

    writeDocsLock(projectDir, updated);

    if (options.json) {
      console.log(JSON.stringify(updated, null, 2));
      return;
    }

    console.log(`\n=== DocOrbit docs.lock Updated ===`);
    if (targetPackage) {
      console.log(`Target Package: ${targetPackage}`);
    } else {
      console.log(`Updated all resolved dependencies.`);
    }

    const lockedCount = Object.keys(updated.dependencies).length;
    console.log(`Total Locked Docs: ${lockedCount}\n`);

    console.log('-----------------------------------------------------------------------------');
    console.log('| Package               | Project Ver | Doc Ver  | Match       | Confidence |');
    console.log('-----------------------------------------------------------------------------');
    for (const [key, dep] of Object.entries(updated.dependencies)) {
      const pkgPad = key.padEnd(21).slice(0, 21);
      const projPad = dep.resolvedDependencyVersion.padEnd(11).slice(0, 11);
      const docPad = dep.docVersion.padEnd(8).slice(0, 8);
      const matchPad = dep.matchType.padEnd(11).slice(0, 11);
      const confPad = (dep.confidence * 100).toFixed(0) + '%';
      console.log(`| ${pkgPad} | ${projPad} | ${docPad} | ${matchPad} | ${confPad.padEnd(10)} |`);
    }
    console.log('-----------------------------------------------------------------------------\n');
  } catch (err: unknown) {
    console.error(`DocOrbit Update Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
