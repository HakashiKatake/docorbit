import type {
  ApiEndpoint,
  DocDiffResult,
  EndpointDiffItem,
  Pitfall,
} from '../../shared/src/index.ts';
import type { DocOrbitRepository } from '../../storage/src/index.ts';

export interface DiffOptions {
  fromVersion?: string;
  toVersion?: string;
  fromSnapshotId?: string;
  toSnapshotId?: string;
  sourceId?: string;
}

export class DocDiffEngine {
  private repo: DocOrbitRepository;

  constructor(repo: DocOrbitRepository) {
    this.repo = repo;
  }

  diff(options: DiffOptions): DocDiffResult {
    const fromEndpoints = this.getEndpoints(options.fromSnapshotId, options.fromVersion);
    const toEndpoints = this.getEndpoints(options.toSnapshotId, options.toVersion);

    const fromPitfalls = this.getPitfalls(options.fromSnapshotId, options.fromVersion);
    const toPitfalls = this.getPitfalls(options.toSnapshotId, options.toVersion);

    // 1. Compute Endpoint Diffs
    const apiChanges: EndpointDiffItem[] = [];
    const fromMap = new Map<string, ApiEndpoint>();
    const toMap = new Map<string, ApiEndpoint>();

    for (const ep of fromEndpoints) {
      fromMap.set(`${ep.method.toUpperCase()} ${ep.path}`, ep);
    }
    for (const ep of toEndpoints) {
      toMap.set(`${ep.method.toUpperCase()} ${ep.path}`, ep);
    }

    let addedCount = 0;
    let removedCount = 0;
    let modifiedCount = 0;
    let deprecatedCount = 0;

    // Check additions, deprecations, and modifications in 'to'
    for (const [key, toEp] of toMap.entries()) {
      const fromEp = fromMap.get(key);

      if (!fromEp) {
        // Newly added endpoint
        apiChanges.push({
          path: toEp.path,
          method: toEp.method,
          changeType: 'added',
          endpoint: toEp,
        });
        addedCount++;
      } else {
        // Existed previously: check deprecation status
        if (toEp.deprecated && !fromEp.deprecated) {
          apiChanges.push({
            path: toEp.path,
            method: toEp.method,
            changeType: 'deprecated',
            endpoint: toEp,
            previousEndpoint: fromEp,
          });
          deprecatedCount++;
        }

        // Check semantic parameter and schema modifications
        const changes = this.detectEndpointModifications(fromEp, toEp);
        if (changes.length > 0) {
          apiChanges.push({
            path: toEp.path,
            method: toEp.method,
            changeType: 'modified',
            changes,
            endpoint: toEp,
            previousEndpoint: fromEp,
          });
          modifiedCount++;
        }
      }
    }

    // Check removals from 'from'
    for (const [key, fromEp] of fromMap.entries()) {
      if (!toMap.has(key)) {
        apiChanges.push({
          path: fromEp.path,
          method: fromEp.method,
          changeType: 'removed',
          endpoint: fromEp,
        });
        removedCount++;
      }
    }

    // 2. Compute Pitfall Diffs
    const pitfallChanges: Array<{ changeType: 'added' | 'removed'; pitfall: Pitfall }> = [];
    const fromPitfallTitles = new Set(fromPitfalls.map(p => `${p.kind}:${p.title}`));
    const toPitfallTitles = new Set(toPitfalls.map(p => `${p.kind}:${p.title}`));

    for (const toP of toPitfalls) {
      if (!fromPitfallTitles.has(`${toP.kind}:${toP.title}`)) {
        pitfallChanges.push({ changeType: 'added', pitfall: toP });
      }
    }
    for (const fromP of fromPitfalls) {
      if (!toPitfallTitles.has(`${fromP.kind}:${fromP.title}`)) {
        pitfallChanges.push({ changeType: 'removed', pitfall: fromP });
      }
    }

    // 3. Compute Content/Chunk Diffs (Semantic only, ignoring formatting-only whitespace)
    const contentChanges = this.computeContentDiffs(options);

    return {
      fromVersion: options.fromVersion,
      toVersion: options.toVersion,
      fromSnapshotId: options.fromSnapshotId,
      toSnapshotId: options.toSnapshotId,
      sourceId: options.sourceId,
      summary: {
        endpointsAdded: addedCount,
        endpointsRemoved: removedCount,
        endpointsModified: modifiedCount,
        endpointsDeprecated: deprecatedCount,
        pitfallsAdded: pitfallChanges.filter(p => p.changeType === 'added').length,
        pitfallsRemoved: pitfallChanges.filter(p => p.changeType === 'removed').length,
        contentChanged: contentChanges.length,
      },
      apiChanges,
      pitfallChanges,
      contentChanges,
      retrievedAt: new Date().toISOString(),
    };
  }

  private getEndpoints(snapshotId?: string, docVersion?: string): ApiEndpoint[] {
    if (snapshotId) {
      return this.repo.getApiEndpointsBySnapshot(snapshotId);
    }
    return this.repo.searchApiEndpoints('', {
      docVersion,
      limit: 500,
    });
  }

  private getPitfalls(snapshotId?: string, docVersion?: string): Pitfall[] {
    if (snapshotId) {
      return this.repo.getPitfallsBySnapshot(snapshotId);
    }
    return this.repo.searchPitfalls('', {
      docVersion,
      limit: 200,
    });
  }

  private detectEndpointModifications(fromEp: ApiEndpoint, toEp: ApiEndpoint): string[] {
    const changes: string[] = [];

    // Compare parameters
    const fromParams = new Map(fromEp.parameters.map(p => [p.name, p]));
    const toParams = new Map(toEp.parameters.map(p => [p.name, p]));

    for (const [name, toP] of toParams.entries()) {
      const fromP = fromParams.get(name);
      if (!fromP) {
        changes.push(`Added parameter "${name}"${toP.required ? ' (required)' : ''}`);
      } else if (!fromP.required && toP.required) {
        changes.push(`Parameter "${name}" is now required (was optional)`);
      } else if (fromP.type !== toP.type && toP.type) {
        changes.push(`Parameter "${name}" type changed from ${fromP.type || 'any'} to ${toP.type}`);
      }
    }

    for (const name of fromParams.keys()) {
      if (!toParams.has(name)) {
        changes.push(`Removed parameter "${name}"`);
      }
    }

    // Compare Request Body required fields
    const fromReq = new Set(fromEp.requestSchema?.required || []);
    const toReq = new Set(toEp.requestSchema?.required || []);

    for (const field of toReq) {
      if (!fromReq.has(field)) {
        changes.push(`Request body field "${field}" is now required`);
      }
    }
    for (const field of fromReq) {
      if (!toReq.has(field)) {
        changes.push(`Request body field "${field}" is no longer required`);
      }
    }

    return changes;
  }

  private computeContentDiffs(options: DiffOptions): Array<{ title: string; changeType: 'added' | 'removed' | 'modified'; summary: string }> {
    const fromChunks = options.fromSnapshotId
      ? this.repo.getChunksBySnapshot(options.fromSnapshotId)
      : options.fromVersion
        ? this.repo.getChunksByVersion(options.fromVersion)
        : [];
    const toChunks = options.toSnapshotId
      ? this.repo.getChunksBySnapshot(options.toSnapshotId)
      : options.toVersion
        ? this.repo.getChunksByVersion(options.toVersion)
        : [];

    if (fromChunks.length === 0 && toChunks.length === 0) return [];

    const changes: Array<{ title: string; changeType: 'added' | 'removed' | 'modified'; summary: string }> = [];
    const fromMap = new Map(fromChunks.map(c => [c.title, c]));
    const toMap = new Map(toChunks.map(c => [c.title, c]));

    for (const [title, toC] of toMap.entries()) {
      const fromC = fromMap.get(title);
      if (!fromC) {
        changes.push({
          title,
          changeType: 'added',
          summary: `New documentation section: "${title}"`,
        });
      } else if (fromC.contentHash !== toC.contentHash) {
        // Compare normalized text to ignore formatting-only whitespace
        const normFrom = fromC.content.replace(/\s+/g, ' ').trim();
        const normTo = toC.content.replace(/\s+/g, ' ').trim();
        if (normFrom !== normTo) {
          changes.push({
            title,
            changeType: 'modified',
            summary: `Content updated for section "${title}"`,
          });
        }
      }
    }

    for (const title of fromMap.keys()) {
      if (!toMap.has(title)) {
        changes.push({
          title,
          changeType: 'removed',
          summary: `Documentation section removed: "${title}"`,
        });
      }
    }

    return changes;
  }
}
