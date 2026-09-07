import { resolve } from 'node:path';
import { DocOrbitDb, DocOrbitRepository, resolveDefaultDbPath } from '../../../../packages/storage/src/index.ts';
import {
  detectWorkspaceDependencies,
  generateDocsLock,
  readDocsLock,
  writeDocsLock,
} from '../../../../packages/workspace/src/index.ts';
import { promptStorageLocation } from '../prompts.ts';

export interface InitCommandOptions {
  json?: boolean;
  dbPath?: string;
  global?: boolean;
  project?: boolean;
}

export async function runInitCommand(
  targetDir: string = '.',
  options: InitCommandOptions = {}
): Promise<void> {
  const projectDir = resolve(targetDir);

  let isGlobal = options.global;
  if (!isGlobal && !options.project && !options.dbPath && !options.json && process.stdin.isTTY) {
    const choice = await promptStorageLocation(projectDir);
    isGlobal = choice === 'global';
  }

  const dbPath = resolveDefaultDbPath(options.dbPath, projectDir, isGlobal);
  const db = new DocOrbitDb(dbPath);
  const repository = new DocOrbitRepository(db);

  try {
    const scanResult = detectWorkspaceDependencies(projectDir);
    const existingLock = readDocsLock(projectDir);
    const lock = generateDocsLock(scanResult, repository, existingLock);

    writeDocsLock(projectDir, lock);

    if (options.json) {
      console.log(JSON.stringify(lock, null, 2));
      return;
    }

    console.log(`\n=== DocOrbit Project Initialization ===`);
    console.log(`Workspace Root:  ${projectDir}`);
    console.log(`Storage Target:  ${isGlobal ? 'Global (~/.docorbit/docorbit.db)' : `Project-local (${dbPath})`}`);
    console.log(`Ecosystems:     ${scanResult.ecosystems.length > 0 ? scanResult.ecosystems.join(', ') : 'None detected'}`);
    console.log(`Manifests:       ${scanResult.manifestsFound.join(', ') || 'None'}`);
    console.log(`Dependencies:    ${scanResult.dependencies.length} detected`);

    const lockedCount = Object.keys(lock.dependencies).length;
    console.log(`Locked Docs:     ${lockedCount} dependencies resolved to documentation\n`);

    if (lockedCount > 0) {
      console.log('-----------------------------------------------------------------------------');
      console.log('| Package               | Project Ver | Doc Ver  | Match       | Confidence |');
      console.log('-----------------------------------------------------------------------------');
      for (const [key, dep] of Object.entries(lock.dependencies)) {
        const pkgPad = key.padEnd(21).slice(0, 21);
        const projPad = dep.resolvedDependencyVersion.padEnd(11).slice(0, 11);
        const docPad = dep.docVersion.padEnd(8).slice(0, 8);
        const matchPad = dep.matchType.padEnd(11).slice(0, 11);
        const confPad = (dep.confidence * 100).toFixed(0) + '%';
        console.log(`| ${pkgPad} | ${projPad} | ${docPad} | ${matchPad} | ${confPad.padEnd(10)} |`);
      }
      console.log('-----------------------------------------------------------------------------');
      console.log(`\nGenerated deterministic docs.lock at: ${projectDir}/docs.lock\n`);
    } else {
      console.log('Note: No ingested documentation matched detected dependencies.');
      console.log('Tip: Use `docorbit add <url>` to ingest official docs for your dependencies, then re-run `docorbit init`.\n');
    }
  } catch (err: unknown) {
    console.error(`DocOrbit Init Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
