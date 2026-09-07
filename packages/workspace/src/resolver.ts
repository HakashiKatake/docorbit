import type {
  DocsLock,
  ProjectDependency,
  WorkspaceScanResult,
  VersionResolutionResult,
} from '../../shared/src/index.ts';
import type { DocOrbitRepository } from '../../storage/src/index.ts';
import { readDocsLock } from './lockfile.ts';
import { detectWorkspaceDependencies } from './detector.ts';
import { resolveDocVersion } from './semver.ts';

export interface ResolvedProjectContext {
  projectDir: string;
  hasLockfile: boolean;
  matchedDependency?: {
    name: string;
    projectVersion: string;
    targetDocVersion: string;
    targetSnapshotId?: string;
    confidence: number;
    matchType: string;
  };
  allDependencies: ProjectDependency[];
}

/**
 * Normalizes query string for token matching against dependency names.
 */
function normalizeQueryTokens(query: string): Set<string> {
  const tokens = query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);

  const set = new Set(tokens);
  // Add common aliases
  if (set.has('nextjs') || set.has('next.js')) {
    set.add('next');
  }
  if (set.has('reactjs') || set.has('react.js')) {
    set.add('react');
  }
  if (set.has('vuejs') || set.has('vue.js')) {
    set.add('vue');
  }
  return set;
}

/**
 * Resolves project context and detects if a query targets a specific dependency in the project.
 * Uses docs.lock if present for zero-overhead deterministic pinned resolution,
 * or falls back to live manifest scanning and resolution.
 */
export function resolveProjectContext(
  projectDir: string,
  query: string,
  repo: DocOrbitRepository
): ResolvedProjectContext {
  const lock = readDocsLock(projectDir);
  const queryTokens = normalizeQueryTokens(query);

  if (lock) {
    // 1. Check locked dependencies
    for (const [key, lockedDoc] of Object.entries(lock.dependencies)) {
      const cleanName = lockedDoc.name.toLowerCase().replace(/^@[^/]+\//, '');
      const parts = cleanName.split(/[-_.]/);

      const matches =
        queryTokens.has(lockedDoc.name.toLowerCase()) ||
        queryTokens.has(cleanName) ||
        parts.some(p => p.length > 2 && queryTokens.has(p));

      if (matches) {
        return {
          projectDir,
          hasLockfile: true,
          matchedDependency: {
            name: lockedDoc.name,
            projectVersion: lockedDoc.resolvedDependencyVersion,
            targetDocVersion: lockedDoc.docVersion,
            targetSnapshotId: lockedDoc.snapshotId,
            confidence: lockedDoc.confidence,
            matchType: lockedDoc.matchType,
          },
          allDependencies: Object.values(lock.dependencies).map(d => ({
            name: d.name,
            ecosystem: d.ecosystem,
            requestedVersion: d.requestedVersion,
            resolvedVersion: d.resolvedDependencyVersion,
            sourceFile: d.sourceFile,
          })),
        };
      }
    }

    return {
      projectDir,
      hasLockfile: true,
      allDependencies: Object.values(lock.dependencies).map(d => ({
        name: d.name,
        ecosystem: d.ecosystem,
        requestedVersion: d.requestedVersion,
        resolvedVersion: d.resolvedDependencyVersion,
        sourceFile: d.sourceFile,
      })),
    };
  }

  // 2. Fallback: scan workspace manifests directly
  const scan = detectWorkspaceDependencies(projectDir);
  const allSnapshots = repo.listSnapshots();
  const allSources = repo.listSources();

  for (const dep of scan.dependencies) {
    const cleanName = dep.name.toLowerCase().replace(/^@[^/]+\//, '');
    const parts = cleanName.split(/[-_.]/);

    const matches =
      queryTokens.has(dep.name.toLowerCase()) ||
      queryTokens.has(cleanName) ||
      parts.some(p => p.length > 2 && queryTokens.has(p));

    if (matches) {
      // Find matching source
      const src = allSources.find(s => {
        const u = s.url.toLowerCase();
        return u.includes(cleanName) || u.includes(dep.name.toLowerCase());
      });

      if (src) {
        const snapshots = allSnapshots.filter(s => s.sourceId === src.id);
        const availableVersions = snapshots.map(s => s.docVersion || 'latest');
        const projectVer = dep.resolvedVersion || dep.requestedVersion;
        const resolution = resolveDocVersion(projectVer, availableVersions, dep.name);

        const chosenSnapshot = snapshots.find(
          s => (s.docVersion || 'latest') === resolution.selectedDocVersion
        ) || snapshots[0];

        return {
          projectDir,
          hasLockfile: false,
          matchedDependency: {
            name: dep.name,
            projectVersion: projectVer,
            targetDocVersion: resolution.selectedDocVersion,
            targetSnapshotId: chosenSnapshot?.id,
            confidence: resolution.confidence,
            matchType: resolution.matchType,
          },
          allDependencies: scan.dependencies,
        };
      }
    }
  }

  return {
    projectDir,
    hasLockfile: false,
    allDependencies: scan.dependencies,
  };
}

export interface WorkspaceMatch {
  dependency: ProjectDependency;
  targetVersion: string;
  confidence: number;
  snapshotId?: string;
  matchedBy: string;
}

export interface WorkspaceResolutionSummary {
  matches: WorkspaceMatch[];
}

export class WorkspaceResolver {
  private repo: DocOrbitRepository;

  constructor(repo: DocOrbitRepository) {
    this.repo = repo;
  }

  resolveProjectContext(projectDir: string, query: string): ResolvedProjectContext {
    return resolveProjectContext(projectDir, query, this.repo);
  }

  scanWorkspace(projectDir: string): WorkspaceScanResult {
    return detectWorkspaceDependencies(projectDir);
  }

  resolveWorkspace(scan: WorkspaceScanResult, _existingLock?: DocsLock | null): WorkspaceResolutionSummary {
    const allSnapshots = this.repo.listSnapshots();
    const allSources = this.repo.listSources();
    const matches: WorkspaceMatch[] = [];

    for (const dep of scan.dependencies) {
      const cleanName = dep.name.toLowerCase().replace(/^@[^/]+\//, '');
      const src = allSources.find(s => {
        const u = s.url.toLowerCase();
        return u.includes(cleanName) || u.includes(dep.name.toLowerCase()) ||
          (s.metadata && String(s.metadata.name || '').toLowerCase() === cleanName);
      });

      if (!src) continue;

      const snapshots = allSnapshots.filter(s => s.sourceId === src.id);
      if (snapshots.length === 0) continue;

      const availableVersions = snapshots.map(s => s.docVersion || 'latest');
      const projectVer = dep.resolvedVersion || dep.requestedVersion;
      const resolution = resolveDocVersion(projectVer, availableVersions, dep.name);

      const chosenSnapshot = snapshots.find(
        s => (s.docVersion || 'latest') === resolution.selectedDocVersion
      ) || snapshots[0];

      matches.push({
        dependency: dep,
        targetVersion: resolution.selectedDocVersion,
        confidence: resolution.confidence,
        snapshotId: chosenSnapshot?.id,
        matchedBy: resolution.matchType,
      });
    }

    return { matches };
  }

  resolveVersion(projectVersion: string, availableDocVersions: string[], packageName?: string): VersionResolutionResult {
    return resolveDocVersion(projectVersion, availableDocVersions, packageName);
  }
}

