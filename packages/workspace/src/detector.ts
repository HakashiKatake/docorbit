import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type {
  Ecosystem,
  ProjectDependency,
  WorkspaceScanResult,
} from '../../shared/src/index.ts';
import {
  type EcosystemStrategy,
  getDefaultStrategies,
} from './ecosystems/index.ts';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.docorbit',
  'dist',
  'build',
  'target',
  'vendor',
  '.venv',
  'venv',
  '.next',
  '.turbo',
]);

/**
 * Recursively locates files in a directory up to a max depth, skipping ignored folders.
 */
function findManifestFiles(
  dir: string,
  targetFileNames: Set<string>,
  maxDepth: number = 4,
  currentDepth: number = 0
): string[] {
  if (currentDepth > maxDepth) return [];
  const results: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findManifestFiles(fullPath, targetFileNames, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (targetFileNames.has(name)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Directory unreadable, ignore
  }

  return results;
}

/**
 * Scans a workspace directory, detects package manifests across supported ecosystems,
 * correlates lockfiles with resolved versions, and preserves monorepo boundaries.
 */
export function detectWorkspaceDependencies(
  workspaceDir: string,
  strategies: EcosystemStrategy[] = getDefaultStrategies()
): WorkspaceScanResult {
  // Index strategies by manifest and lockfile names
  const manifestMap = new Map<string, EcosystemStrategy>();
  const lockfileMap = new Map<string, EcosystemStrategy>();
  const allTargetNames = new Set<string>();

  for (const strat of strategies) {
    for (const mName of strat.manifestNames) {
      const lower = mName.toLowerCase();
      manifestMap.set(lower, strat);
      allTargetNames.add(lower);
    }
    if (strat.lockfileNames) {
      for (const lName of strat.lockfileNames) {
        const lower = lName.toLowerCase();
        lockfileMap.set(lower, strat);
        allTargetNames.add(lower);
      }
    }
  }

  const manifests = findManifestFiles(workspaceDir, allTargetNames);
  const ecosystems = new Set<Ecosystem>();
  const dependencies: ProjectDependency[] = [];
  const manifestsFound: string[] = [];

  // 1. Gather all lockfiles first to correlate resolved versions
  const lockfileCache = new Map<string, Map<string, string>>();

  for (const file of manifests) {
    const rel = relative(workspaceDir, file);
    manifestsFound.push(rel);
    const baseName = file.split(/[/\\]/).pop()?.toLowerCase() || '';

    const lockStrategy = lockfileMap.get(baseName);
    if (lockStrategy && lockStrategy.parseLockfile) {
      try {
        const content = readFileSync(file, 'utf-8');
        lockfileCache.set(rel, lockStrategy.parseLockfile(baseName, content));
      } catch {
        // Ignore unreadable lockfile
      }
    }
  }

  // 2. Parse package manifests and resolve versions
  for (const file of manifests) {
    const rel = relative(workspaceDir, file);
    const baseName = file.split(/[/\\]/).pop()?.toLowerCase() || '';
    const pkgDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.';

    const strat = manifestMap.get(baseName);
    if (strat) {
      try {
        const content = readFileSync(file, 'utf-8');
        ecosystems.add(strat.ecosystem);
        const parsed = strat.parseManifest(baseName, content, rel, pkgDir);

        if (strat.resolveVersions) {
          strat.resolveVersions(parsed, pkgDir, lockfileCache);
        }

        dependencies.push(...parsed);
      } catch {
        // Ignore parse failure
      }
    }
  }

  return {
    workspaceRoot: workspaceDir,
    ecosystems: Array.from(ecosystems),
    manifestsFound,
    dependencies,
  };
}
