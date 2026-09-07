import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DocsLock,
  LockedDoc,
  WorkspaceScanResult,
  ProjectDependency,
  DocVersionMatch,
} from '../../shared/src/index.ts';
import type { DocOrbitRepository } from '../../storage/src/index.ts';
import { resolveDocVersion } from './semver.ts';

export const DOCS_LOCK_FILENAME = 'docs.lock';

/**
 * Reads and parses docs.lock from a project directory if present.
 */
export function readDocsLock(projectDir: string): DocsLock | null {
  const filePath = join(projectDir, DOCS_LOCK_FILENAME);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && typeof parsed.dependencies === 'object') {
      return parsed as DocsLock;
    }
  } catch {
    // Malformed lockfile
  }
  return null;
}

/**
 * Deterministically writes a docs.lock file to project directory.
 * Sorts dependency keys alphabetically and uses 2-space indentation.
 */
export function writeDocsLock(projectDir: string, lock: DocsLock): void {
  const filePath = join(projectDir, DOCS_LOCK_FILENAME);

  // Sort dependency keys alphabetically
  const sortedDeps: Record<string, LockedDoc> = {};
  for (const key of Object.keys(lock.dependencies).sort()) {
    sortedDeps[key] = lock.dependencies[key];
  }

  const deterministicLock: DocsLock = {
    version: 1,
    workspaceRoot: lock.workspaceRoot,
    dependencies: sortedDeps,
  };

  const serialized = JSON.stringify(deterministicLock, null, 2) + '\n';
  writeFileSync(filePath, serialized, 'utf-8');
}

/**
 * Helper to match a project dependency to an ingested source in the repository.
 */
function findMatchingSource(dep: ProjectDependency, repo: DocOrbitRepository) {
  const sources = repo.listSources();
  const depClean = dep.name.toLowerCase().replace(/^@[^/]+\//, ''); // e.g. @stripe/stripe-js -> stripe-js

  for (const src of sources) {
    const srcUrl = src.url.toLowerCase();
    // Direct match: URL or metadata contains dependency name
    if (
      srcUrl.includes(depClean) ||
      srcUrl.includes(dep.name.toLowerCase()) ||
      (src.metadata && String(src.metadata.name || '').toLowerCase() === depClean)
    ) {
      return src;
    }
  }
  return null;
}

/**
 * Generates a DocsLock manifest from workspace scan result and repository state.
 * Preserves timestamps for unchanged documentation snapshots to prevent lockfile churn.
 */
export function generateDocsLock(
  scanResult: WorkspaceScanResult,
  repo: DocOrbitRepository,
  existingLock?: DocsLock | null
): DocsLock {
  const lockedDeps: Record<string, LockedDoc> = {};
  const allSnapshots = repo.listSnapshots();

  // Detect duplicate package names across monorepo packages
  const nameCounts = new Map<string, number>();
  for (const dep of scanResult.dependencies) {
    nameCounts.set(dep.name, (nameCounts.get(dep.name) || 0) + 1);
  }

  for (const dep of scanResult.dependencies) {
    // Monorepo key disambiguation
    const isMulti = (nameCounts.get(dep.name) || 0) > 1;
    const depKey = isMulti && dep.packagePath && dep.packagePath !== '.'
      ? `${dep.packagePath}:${dep.name}`
      : dep.name;

    // Check if we have documentation for this dependency
    const matchingSource = findMatchingSource(dep, repo);
    if (!matchingSource) continue;

    // Find snapshots for matching source
    const sourceSnapshots = allSnapshots.filter(s => s.sourceId === matchingSource.id);
    if (sourceSnapshots.length === 0) continue;

    // Gather available versions from snapshots
    const versionToSnapshot = new Map<string, typeof sourceSnapshots[0]>();
    for (const snap of sourceSnapshots) {
      const v = snap.docVersion || 'latest';
      if (!versionToSnapshot.has(v)) {
        versionToSnapshot.set(v, snap);
      }
    }

    const availableVersions = Array.from(versionToSnapshot.keys());
    const projectVersion = dep.resolvedVersion || dep.requestedVersion;
    const resolution = resolveDocVersion(projectVersion, availableVersions, dep.name);

    const selectedSnapshot = versionToSnapshot.get(resolution.selectedDocVersion) || sourceSnapshots[0];
    const snapshotHash = selectedSnapshot.snapshotHash;

    // Deterministic timestamp preservation:
    // If existingLock already has this dependency with identical snapshotHash and resolvedVersion, keep the timestamp
    const existing = existingLock?.dependencies[depKey];
    const isUnchanged =
      existing &&
      existing.snapshotHash === snapshotHash &&
      existing.resolvedDependencyVersion === (dep.resolvedVersion || dep.requestedVersion) &&
      existing.docVersion === resolution.selectedDocVersion;

    const retrievedAt = isUnchanged ? existing.retrievedAt : new Date().toISOString();

    lockedDeps[depKey] = {
      name: dep.name,
      ecosystem: dep.ecosystem,
      requestedVersion: dep.requestedVersion,
      resolvedDependencyVersion: dep.resolvedVersion || dep.requestedVersion,
      sourceFile: dep.sourceFile,
      docSourceUrl: matchingSource.url,
      docVersion: resolution.selectedDocVersion,
      matchType: resolution.matchType,
      confidence: resolution.confidence,
      snapshotId: selectedSnapshot.id,
      snapshotHash,
      retrievedAt,
    };
  }

  return {
    version: 1,
    workspaceRoot: scanResult.workspaceRoot,
    dependencies: lockedDeps,
  };
}

/**
 * Selectively or globally updates docs.lock for a project.
 */
export function updateDocsLock(
  scanResult: WorkspaceScanResult,
  repo: DocOrbitRepository,
  existingLock: DocsLock,
  specificDependency?: string
): DocsLock {
  if (!specificDependency) {
    // Full update: regenerate with existing lock as baseline for unchanged items
    return generateDocsLock(scanResult, repo, existingLock);
  }

  // Selective update: only force refresh of specific dependency
  const updated = generateDocsLock(scanResult, repo, existingLock);
  const resultDeps = { ...existingLock.dependencies };

  for (const [key, doc] of Object.entries(updated.dependencies)) {
    if (doc.name === specificDependency || key === specificDependency) {
      // Force new timestamp for the target dependency being updated
      resultDeps[key] = {
        ...doc,
        retrievedAt: new Date().toISOString(),
      };
    }
  }

  return {
    version: 1,
    workspaceRoot: scanResult.workspaceRoot,
    dependencies: resultDeps,
  };
}
